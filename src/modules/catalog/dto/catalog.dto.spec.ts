import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { CreateModelDto, UpdateModelDto } from './catalog.dto';

describe('model slug DTO validation', () => {
  const validCreate = {
    kind: 'CAMERA',
    categoryId: 'category',
    brandId: 'brand',
    name: 'Pentax 17',
    description: 'Camera',
    pricePerDay: 100,
    deposit: 100,
  };

  it('allows an omitted slug and normalizes a supplied slug', () => {
    const omitted = plainToInstance(CreateModelDto, validCreate);
    expect(validateSync(omitted)).toHaveLength(0);

    const supplied = plainToInstance(CreateModelDto, { ...validCreate, slug: '  Pentax-17  ' });
    expect(supplied.slug).toBe('pentax-17');
    expect(validateSync(supplied)).toHaveLength(0);
  });

  it('rejects an invalid supplied slug on create and update', () => {
    const create = plainToInstance(CreateModelDto, { ...validCreate, slug: 'Bad Slug!' });
    const update = plainToInstance(UpdateModelDto, { slug: 'Bad Slug!' });

    expect(validateSync(create).some((error) => error.property === 'slug')).toBe(true);
    expect(validateSync(update).some((error) => error.property === 'slug')).toBe(true);
  });
});
