import { BadRequestException } from '@nestjs/common';

const VIETNAM_TZ = 'Asia/Ho_Chi_Minh';
const MS_PER_DAY = 1000 * 60 * 60 * 24;

export function getTodayVietnamIso(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: VIETNAM_TZ,
  }).format(new Date());
}

export function getTodayVietnamUtcDate(): Date {
  return parseIsoDateToUtc(getTodayVietnamIso());
}

export function parseIsoDateToUtc(isoDate: string): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(isoDate)) {
    throw new BadRequestException({
      code: 'VALIDATION_ERROR',
      message: 'Định dạng ngày không hợp lệ (yêu cầu YYYY-MM-DD).',
      details: {},
    });
  }

  const [year, month, day] = isoDate.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    throw new BadRequestException({
      code: 'VALIDATION_ERROR',
      message: 'Ngày không tồn tại trong lịch.',
      details: {},
    });
  }
  return date;
}

export function formatUtcDateToIso(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function diffDaysIso(startIso: string, endIso: string): number {
  const start = parseIsoDateToUtc(startIso);
  const end = parseIsoDateToUtc(endIso);
  return Math.round((end.getTime() - start.getTime()) / MS_PER_DAY);
}

export function getMonthRange(monthStr: string): {
  startDate: Date;
  endExclusiveDate: Date;
  daysInMonth: number;
  year: number;
  month: number;
} {
  if (!/^\d{4}-\d{2}$/.test(monthStr)) {
    throw new BadRequestException({
      code: 'VALIDATION_ERROR',
      message: 'Định dạng tháng không hợp lệ (yêu cầu YYYY-MM).',
      details: { fields: { month: 'Định dạng tháng phải là YYYY-MM' } },
    });
  }

  const [year, month] = monthStr.split('-').map(Number);
  if (month < 1 || month > 12) {
    throw new BadRequestException({
      code: 'VALIDATION_ERROR',
      message: 'Tháng không hợp lệ.',
      details: { fields: { month: 'Tháng phải từ 01 đến 12' } },
    });
  }

  const startDate = new Date(Date.UTC(year, month - 1, 1));
  const endExclusiveDate = new Date(Date.UTC(year, month, 1));
  const daysInMonth = Math.round(
    (endExclusiveDate.getTime() - startDate.getTime()) / MS_PER_DAY,
  );

  return { startDate, endExclusiveDate, daysInMonth, year, month };
}
