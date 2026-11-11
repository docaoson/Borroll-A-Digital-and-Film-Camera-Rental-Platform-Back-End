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
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Public } from '../../common/decorators/public.decorator';
import {
  CancelBookingDto,
  CreateBookingDto,
  ListMyBookingsQueryDto,
  QuoteBookingDto,
} from './dto/booking.dto';
import { BookingService } from './booking.service';

@ApiTags('Bookings')
@Controller('bookings')
export class BookingController {
  constructor(private readonly bookingService: BookingService) {}

  @Public()
  @Post('quote')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Báo giá và kiểm tra còn trống (không giữ chỗ)' })
  quote(@Body() dto: QuoteBookingDto) {
    return this.bookingService.quote(dto);
  }

  @ApiBearerAuth()
  @Post()
  @ApiOperation({ summary: 'Tạo yêu cầu đặt thuê (PENDING)' })
  createBooking(
    @CurrentUser('userId') userId: string,
    @Body() dto: CreateBookingDto,
  ) {
    return this.bookingService.createBooking(userId, dto);
  }

  @ApiBearerAuth()
  @Get()
  @ApiOperation({ summary: 'Danh sách đơn thuê của tôi' })
  listMyBookings(
    @CurrentUser('userId') userId: string,
    @Query() query: ListMyBookingsQueryDto,
  ) {
    return this.bookingService.listMyBookings(userId, query);
  }

  @ApiBearerAuth()
  @Get(':id')
  @ApiOperation({ summary: 'Chi tiết đơn thuê' })
  getBookingDetail(
    @Param('id') id: string,
    @CurrentUser('userId') userId: string,
    @CurrentUser('roles') roles: string[],
  ) {
    return this.bookingService.getBookingDetail(id, userId, roles);
  }

  @ApiBearerAuth()
  @Post(':id/cancel')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Khách hàng hủy đơn thuê' })
  cancelMyBooking(
    @Param('id') id: string,
    @CurrentUser('userId') userId: string,
    @Body() dto: CancelBookingDto,
  ) {
    return this.bookingService.cancelMyBooking(id, userId, dto);
  }
}

