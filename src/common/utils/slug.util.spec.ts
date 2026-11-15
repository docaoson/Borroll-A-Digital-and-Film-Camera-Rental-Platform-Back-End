import { slugify, MODEL_SLUG_PATTERN } from './slug.util';

describe('slugify utility', () => {
  it('converts Vietnamese characters including đ/Đ to expected slug', () => {
    const result = slugify('Đen Đảo');
    expect(result).toBe('den-dao');
  });

  it('handles multiple Vietnamese diacritics and mixed case', () => {
    const input = 'CẢM XÚC ĐÁNG YÊU';
    const result = slugify(input);
    // Expected: remove diacritics, lowercase, replace spaces with hyphens
    expect(result).toBe('cam-xuc-dang-yeu');
  });

  it('produces fallback slug when input yields empty string', () => {
    const result = slugify('!!!');
    expect(result).toMatch(/^san-pham-[0-9a-f]+$/);
  });

  it('does not have leading or trailing hyphens', () => {
    const result = slugify('   *Hello*   ');
    expect(result.startsWith('-')).toBeFalsy();
    expect(result.endsWith('-')).toBeFalsy();
  });
});
