import { slugify } from './slug.util';

describe('slugify', () => {
  it('removes Vietnamese diacritics and maps đ/Đ to d', () => {
    expect(slugify('Đèn Đỏ Máy Ảnh')).toBe('den-do-may-anh');
  });

  it('uses a random san-pham slug when the name has no ASCII letters or digits', () => {
    expect(slugify('✨!!!')).toMatch(/^san-pham-[a-f0-9]{6}$/);
  });
});
