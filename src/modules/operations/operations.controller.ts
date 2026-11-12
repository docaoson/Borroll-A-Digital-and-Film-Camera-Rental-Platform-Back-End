import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import {
  CompleteBookingDto,
  HandoverPhotoPresignDto,
  PickupBookingDto,
  ReasonBodyDto,
  ReturnBookingDto,
  StaffBookingsQueryDto,
  StaffDashboardQueryDto,
} from './dto/operations.dto';
import { OperationsService } from './operations.service';

@ApiTags('Staff Operations')
@ApiBearerAuth()
@Roles(Role.STAFF)
@Controller('staff')
export class OperationsController {
  constructor(private readonly operationsService: OperationsService) {}

  @Get('dashboard')
  @ApiOperation({ summary: 'Tổng quan vận hành cửa hàng trong ngày' })
  getDashboard(
    @Query() query: StaffDashboardQueryDto,
    @CurrentUser('roles') roles: string[],
  ) {
    return this.operationsService.getDashboard(query, roles);
  }

  @Get('bookings')
  @ApiOperation({ summary: 'Danh sách đơn thuê cho nhân viên' })
  listBookings(
    @Query() query: StaffBookingsQueryDto,
    @CurrentUser('roles') roles: string[],
  ) {
    return this.operationsService.listStaffBookings(query, roles);
  }

  @Post('handover-photos/presign')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Xin URL tải ảnh biên bản giao nhận lên Storage' })
  presignHandoverPhoto(@Body() dto: HandoverPhotoPresignDto) {
    return this.operationsService.presignHandoverPhoto(dto);
  }

  @Post('bookings/:id/confirm')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Xác nhận đơn thuê (PENDING -> CONFIRMED)' })
  confirmBooking(
    @Param('id') id: string,
    @CurrentUser('userId') actorId: string,
    @CurrentUser('roles') roles: string[],
  ) {
    return this.operationsService.confirmBooking(id, actorId, roles);
  }

  @Post('bookings/:id/reject')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Từ chối đơn thuê (PENDING -> REJECTED)' })
  rejectBooking(
    @Param('id') id: string,
    @Body() dto: ReasonBodyDto,
    @CurrentUser('userId') actorId: string,
    @CurrentUser('roles') roles: string[],
  ) {
    return this.operationsService.rejectBooking(id, dto, actorId, roles);
  }

  @Post('bookings/:id/cancel')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Nhân viên hủy đơn thuê' })
  cancelBooking(
    @Param('id') id: string,
    @Body() dto: ReasonBodyDto,
    @CurrentUser('userId') actorId: string,
    @CurrentUser('roles') roles: string[],
  ) {
    return this.operationsService.cancelBooking(id, dto, actorId, roles);
  }

  @Post('bookings/:id/pickup')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Giao máy & thu tiền (CONFIRMED -> PICKED_UP)' })
  pickupBooking(
    @Param('id') id: string,
    @Body() dto: PickupBookingDto,
    @CurrentUser('userId') actorId: string,
    @CurrentUser('roles') roles: string[],
  ) {
    return this.operationsService.pickupBooking(id, dto, actorId, roles);
  }

  @Post('bookings/:id/return')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Nhận lại máy (PICKED_UP -> RETURNED)' })
  returnBooking(
    @Param('id') id: string,
    @Body() dto: ReturnBookingDto,
    @CurrentUser('userId') actorId: string,
    @CurrentUser('roles') roles: string[],
  ) {
    return this.operationsService.returnBooking(id, dto, actorId, roles);
  }

  @Post('bookings/:id/complete')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Hoàn tất đơn & hoàn cọc (RETURNED -> COMPLETED)' })
  completeBooking(
    @Param('id') id: string,
    @Body() dto: CompleteBookingDto,
    @CurrentUser('userId') actorId: string,
    @CurrentUser('roles') roles: string[],
  ) {
    return this.operationsService.completeBooking(id, dto, actorId, roles);
  }
}
