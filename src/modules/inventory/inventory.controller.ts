import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import {
  CreateUnitBlockDto,
  CreateUnitDto,
  ListUnitBlocksQueryDto,
  ListUnitsQueryDto,
  UpdateUnitDto,
} from './dto/unit.dto';
import { InventoryService } from './inventory.service';

@ApiTags('Inventory (Staff & Admin)')
@ApiBearerAuth()
@Controller()
export class InventoryController {
  constructor(private readonly inventoryService: InventoryService) {}

  @Roles(Role.STAFF)
  @Get('staff/units')
  @ApiOperation({ summary: 'Danh sách từng chiếc máy trong kho' })
  listStaffUnits(@Query() query: ListUnitsQueryDto) {
    return this.inventoryService.listStaffUnits(query);
  }

  @Roles(Role.STAFF)
  @Get('staff/unit-blocks')
  @ApiOperation({ summary: 'Danh sách lịch khóa bảo trì' })
  listUnitBlocks(@Query() query: ListUnitBlocksQueryDto) {
    return this.inventoryService.listUnitBlocks(query);
  }

  @Roles(Role.STAFF)
  @Post('staff/unit-blocks')
  @ApiOperation({ summary: 'Tạo lịch khóa bảo trì cho một chiếc máy' })
  createUnitBlock(
    @Body() dto: CreateUnitBlockDto,
    @CurrentUser('userId') actorId: string,
  ) {
    return this.inventoryService.createUnitBlock(dto, actorId);
  }

  @Roles(Role.STAFF)
  @Delete('staff/unit-blocks/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Xóa lịch khóa bảo trì' })
  deleteUnitBlock(
    @Param('id') id: string,
    @CurrentUser('userId') actorId: string,
  ) {
    return this.inventoryService.deleteUnitBlock(id, actorId);
  }

  @Roles(Role.ADMIN)
  @Get('admin/units')
  @ApiOperation({ summary: 'Admin: Danh sách từng chiếc máy' })
  listAdminUnits(@Query() query: ListUnitsQueryDto) {
    return this.inventoryService.listStaffUnits(query);
  }

  @Roles(Role.ADMIN)
  @Get('admin/units/:id')
  @ApiOperation({ summary: 'Admin: Chi tiết chiếc máy' })
  getAdminUnit(@Param('id') id: string) {
    return this.inventoryService.getAdminUnit(id);
  }

  @Roles(Role.ADMIN)
  @Post('admin/units')
  @ApiOperation({ summary: 'Admin: Tạo chiếc máy mới' })
  createAdminUnit(
    @Body() dto: CreateUnitDto,
    @CurrentUser('userId') actorId: string,
  ) {
    return this.inventoryService.createAdminUnit(dto, actorId);
  }

  @Roles(Role.ADMIN)
  @Patch('admin/units/:id')
  @ApiOperation({ summary: 'Admin: Cập nhật chiếc máy' })
  updateAdminUnit(
    @Param('id') id: string,
    @Body() dto: UpdateUnitDto,
    @CurrentUser('userId') actorId: string,
  ) {
    return this.inventoryService.updateAdminUnit(id, dto, actorId);
  }

  @Roles(Role.ADMIN)
  @Delete('admin/units/:id')
  @ApiOperation({ summary: 'Admin: Xóa hoặc ngừng sử dụng chiếc máy' })
  deleteAdminUnit(
    @Param('id') id: string,
    @CurrentUser('userId') actorId: string,
  ) {
    return this.inventoryService.deleteAdminUnit(id, actorId);
  }
}
