import { ConflictException } from '@nestjs/common';
import { BookingStatus, Role } from '@prisma/client';

export type BookingAction =
  'cancel' | 'confirm' | 'reject' | 'pickup' | 'return' | 'complete';

export type ViewerRole = 'CUSTOMER' | 'STAFF' | 'ADMIN';

const ALLOWED_TRANSITIONS: Record<BookingStatus, BookingStatus[]> = {
  [BookingStatus.PENDING]: [
    BookingStatus.CONFIRMED,
    BookingStatus.REJECTED,
    BookingStatus.CANCELLED,
  ],
  [BookingStatus.CONFIRMED]: [BookingStatus.PICKED_UP, BookingStatus.CANCELLED],
  [BookingStatus.PICKED_UP]: [BookingStatus.RETURNED],
  [BookingStatus.RETURNED]: [BookingStatus.COMPLETED],
  [BookingStatus.COMPLETED]: [],
  [BookingStatus.REJECTED]: [],
  [BookingStatus.CANCELLED]: [],
};

export function assertValidBookingTransition(
  from: BookingStatus,
  to: BookingStatus,
): void {
  const allowed = ALLOWED_TRANSITIONS[from] ?? [];
  if (!allowed.includes(to)) {
    throw new ConflictException({
      code: 'INVALID_STATUS_TRANSITION',
      message: 'Hành động không hợp lệ với trạng thái hiện tại.',
      details: { from, to },
    });
  }
}

export function computeViewerContext(
  status: BookingStatus,
  userRoles: string[],
): { viewerRole: ViewerRole; allowedActions: BookingAction[] } {
  const isAdmin = userRoles.includes(Role.ADMIN);
  const isStaff = isAdmin || userRoles.includes(Role.STAFF);

  if (!isStaff) {
    const allowedActions: BookingAction[] =
      status === BookingStatus.PENDING || status === BookingStatus.CONFIRMED
        ? ['cancel']
        : [];
    return { viewerRole: 'CUSTOMER', allowedActions };
  }

  const viewerRole: ViewerRole = isAdmin ? 'ADMIN' : 'STAFF';
  let allowedActions: BookingAction[] = [];

  switch (status) {
    case BookingStatus.PENDING:
      allowedActions = ['confirm', 'reject', 'cancel'];
      break;
    case BookingStatus.CONFIRMED:
      allowedActions = ['pickup', 'cancel'];
      break;
    case BookingStatus.PICKED_UP:
      allowedActions = ['return'];
      break;
    case BookingStatus.RETURNED:
      allowedActions = ['complete'];
      break;
    default:
      allowedActions = [];
      break;
  }

  return { viewerRole, allowedActions };
}
