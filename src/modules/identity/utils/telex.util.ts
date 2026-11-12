const ZERO_WIDTH_REGEX = /[\u200B-\u200D\uFEFF\u2060]/g;

const TONE_TO_TELEX_KEY: Record<string, string> = {
  '\u0301': 's', // sắc
  '\u0300': 'f', // huyền
  '\u0309': 'r', // hỏi
  '\u0303': 'x', // ngã
  '\u0323': 'j', // nặng
};

export function decodeTelexWordToAscii(word: string): string {
  if (!word) return word;
  const nfd = word.normalize('NFD');
  const hadVietnameseMark = /[\u0300-\u0323đĐ]/.test(nfd);

  let preExpanded = nfd;
  if (hadVietnameseMark) {
    preExpanded = preExpanded.replace(
      /([aeiouyAEIOUY])(\u0306|\u0302|\u031B)?(?![\u0300-\u0323])([sfrxjSFRXJ])(?!\3)/g,
      (_full, vowel: string, hat: string | undefined, key: string) =>
        `${vowel}${hat || ''}${key}${key}`,
    );
  }

  let base = '';
  const deferred: string[] = [];
  let emittedWInWord = false;

  for (let i = 0; i < preExpanded.length; i++) {
    const ch = preExpanded[i];
    const next1 = preExpanded[i + 1];
    const next2 = preExpanded[i + 2];

    if (ch === 'đ') {
      base += 'dd';
      continue;
    }
    if (ch === 'Đ') {
      base += 'Dd';
      continue;
    }

    const diacritics: string[] = [];
    if (next1 && /[\u0300-\u0323]/.test(next1)) {
      diacritics.push(next1);
      i += 1;
      if (next2 && /[\u0300-\u0323]/.test(next2)) {
        diacritics.push(next2);
        i += 1;
      }
    }

    if (diacritics.length === 0) {
      base += ch;
      continue;
    }

    const hasBreve = diacritics.includes('\u0306'); // ă
    const hasCircumflex = diacritics.includes('\u0302'); // â, ê, ô
    const hasHorn = diacritics.includes('\u031B'); // ơ, ư
    const tone = diacritics.find((d) => d in TONE_TO_TELEX_KEY);
    const toneKey = tone ? TONE_TO_TELEX_KEY[tone] : '';

    if (hasBreve) {
      base += ch;
      if (!emittedWInWord) {
        deferred.push('w');
        emittedWInWord = true;
      }
      if (toneKey) deferred.push(toneKey);
    } else if (hasCircumflex) {
      base += `${ch}${ch.toLowerCase()}`;
      if (toneKey) deferred.push(toneKey);
    } else if (hasHorn) {
      const lower = ch.toLowerCase();
      if (lower === 'u') {
        base += ch === 'Ư' || ch === 'U' ? 'W' : 'w';
        emittedWInWord = true;
        if (toneKey) base += toneKey;
      } else if (lower === 'o') {
        if (emittedWInWord) {
          base += `${ch}${toneKey}`;
        } else {
          base += `${ch}${toneKey}`;
          if (!toneKey) {
            base += 'w';
          } else {
            deferred.push('w');
          }
          emittedWInWord = true;
        }
      } else {
        base += `${ch}w${toneKey}`;
      }
    } else if (toneKey) {
      base += `${ch}${toneKey}`;
    } else {
      base += ch;
    }
  }

  if (deferred.length > 0) {
    const modStr = deferred.join('');
    const match = base.match(
      /^([^aeiouyAEIOUY]*[aeiouyAEIOUY]+[bcdfghjklmnpqrstvwxzBCDFGHJKLMNPQRSTVWXZ]+)(.*)$/,
    );
    if (match) {
      base = `${match[1]}${modStr}${match[2]}`;
    } else {
      base = `${base}${modStr}`;
    }
  }

  return base;
}

export function normalizeAsciiCredential(rawValue: string): string {
  if (!rawValue) return '';
  const cleaned = rawValue.normalize('NFC').replace(ZERO_WIDTH_REGEX, '');

  return cleaned
    .split(/([^a-zA-Z\u00C0-\u1EF9]+)/)
    .map((part) => {
      if (/^[a-zA-Z\u00C0-\u1EF9]+$/.test(part)) {
        return decodeTelexWordToAscii(part);
      }
      return part;
    })
    .join('');
}

/**
 * Khôi phục danh sách ứng viên chuỗi ASCII gốc từ chuỗi bị biến đổi bởi bộ gõ tiếng Việt (Telex / VNI)
 */
export function generateVietnameseImeCandidates(raw: string): string[] {
  if (typeof raw !== 'string' || !raw) return [];

  const cleaned = raw.normalize('NFC').replace(ZERO_WIDTH_REGEX, '');
  const primaryDecoded = normalizeAsciiCredential(cleaned);

  const candidates = new Set<string>([
    cleaned,
    cleaned.trim(),
    primaryDecoded,
    primaryDecoded.trim(),
    // Trường hợp gõ lặp ss/rr nhưng không còn dấu tiếng Việt nào khác trong từ (vd: Pasword123! -> Password123!, boroll -> borroll)
    primaryDecoded.replace(/([aeiouyAEIOUY])([sfrxjSFRXJ])(?!\2)/g, '$1$2$2'),
    raw.normalize('NFD').replace(ZERO_WIDTH_REGEX, ''),
  ]);

  // Thêm các ứng viên khi chỉ 1 vị trí bị Unikey nuốt phím lặp (vd: Pasword123! chỉ nuốt 's' ở 'Pas', còn 'or' giữ nguyên -> Password123!)
  const singleUndoRegex = /([aeiouyAEIOUY])([sfrxjSFRXJ])(?!\2)/g;
  let match: RegExpExecArray | null;
  while ((match = singleUndoRegex.exec(primaryDecoded)) !== null) {
    const idx = match.index;
    const matchedStr = match[0];
    const vowel = match[1];
    const key = match[2];
    const singleExpanded =
      primaryDecoded.slice(0, idx) +
      `${vowel}${key}${key}` +
      primaryDecoded.slice(idx + matchedStr.length);
    candidates.add(singleExpanded);
    candidates.add(singleExpanded.trim());
  }

  const nfd = cleaned.normalize('NFD');
  const VNI_TONE_MAP: Record<string, string[]> = {
    '\u0301': ['1'],
    '\u0300': ['2', '12'],
    '\u0309': ['3', '123'],
    '\u0303': ['4', '1234'],
    '\u0323': ['5', '12345'],
  };
  for (const [toneChar, digitSeqs] of Object.entries(VNI_TONE_MAP)) {
    if (nfd.includes(toneChar)) {
      const stripped = nfd
        .replace(new RegExp(toneChar, 'g'), '')
        .normalize('NFC');
      for (const digits of digitSeqs) {
        candidates.add(
          stripped.replace(/([a-zA-Z]+)(!+|\?+|#+|\$+|%*)$/, `$1${digits}$2`),
        );
        candidates.add(`${stripped}${digits}`);
      }
    }
  }

  return Array.from(candidates).filter(Boolean);
}

/**
 * Chuẩn hóa địa chỉ email khi người dùng gõ bằng bàn phím đang bật tiếng Việt (Telex/VNI)
 */
export function normalizeEmailWithTelex(rawEmail: string): string {
  const cleaned = (rawEmail || '')
    .normalize('NFC')
    .replace(ZERO_WIDTH_REGEX, '')
    .replace(/\u00A0/g, ' ')
    .trim()
    .toLowerCase();

  if (!cleaned) return cleaned;

  const fixedDomain = cleaned
    .replace(/@b[oơỏởốồổỗộóòõọ]r+oll\.vn$/i, '@borroll.vn')
    .replace(/@boroll\.vn$/i, '@borroll.vn');

  if (!/[^\x20-\x7E]/.test(fixedDomain)) {
    return fixedDomain;
  }

  return normalizeAsciiCredential(fixedDomain)
    .toLowerCase()
    .replace(/@bor+w?roll\.vn$/i, '@borroll.vn')
    .replace(/@boroll\.vn$/i, '@borroll.vn');
}
