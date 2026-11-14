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
import { ManualPaymentStatus } from '@prisma/client';
import { IsEnum, IsOptional } from 'class-validator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { PaymentService } from './payment.service';
import {
  PaymentProofPresignDto,
  RejectPaymentDto,
  SubmitPaymentProofDto,
} from './dto/payment.dto';

class PaymentListQueryDto {
  @IsOptional()
  @IsEnum(ManualPaymentStatus)
  status?: ManualPaymentStatus;
}

@ApiTags('Manual Payments')
@ApiBearerAuth()
@Controller('bookings/:id/payment')
export class RenterPaymentController {
  constructor(private readonly payments: PaymentService) {}

  @Post('proof/presign')
  @ApiOperation({ summary: 'Tạo liên kết tải ảnh minh chứng thanh toán' })
  presign(
    @Param('id') id: string,
    @CurrentUser('userId') userId: string,
    @Body() dto: PaymentProofPresignDto,
  ) {
    return this.payments.presign(id, userId, dto);
  }

  @Post('proof')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Gửi ảnh minh chứng thanh toán' })
  submit(
    @Param('id') id: string,
    @CurrentUser('userId') userId: string,
    @Body() dto: SubmitPaymentProofDto,
  ) {
    return this.payments.submit(id, userId, dto);
  }

  @Get('history')
  @ApiOperation({ summary: 'Xem trạng thái và lịch sử thanh toán' })
  history(
    @Param('id') id: string,
    @CurrentUser('userId') userId: string,
    @CurrentUser('roles') roles: string[],
  ) {
    return this.payments.history(id, userId, roles);
  }
}

@ApiTags('Manual Payments')
@ApiBearerAuth()
@Roles('STAFF', 'ADMIN')
@Controller('staff/payments')
export class StaffPaymentController {
  constructor(private readonly payments: PaymentService) {}

  @Get()
  @ApiOperation({ summary: 'Danh sách thanh toán chuyển khoản cần xử lý' })
  list(@Query() query: PaymentListQueryDto) {
    return this.payments.listAdmin(query.status);
  }

  @Post(':id/confirm')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Xác nhận khoản thanh toán đã đối chiếu' })
  confirm(@Param('id') id: string, @CurrentUser('userId') actorId: string) {
    return this.payments.confirm(id, actorId);
  }

  @Post(':id/reject')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Từ chối minh chứng thanh toán' })
  reject(
    @Param('id') id: string,
    @CurrentUser('userId') actorId: string,
    @Body() dto: RejectPaymentDto,
  ) {
    return this.payments.reject(id, actorId, dto);
  }
}
