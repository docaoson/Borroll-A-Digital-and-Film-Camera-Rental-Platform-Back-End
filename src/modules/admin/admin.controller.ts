import { Body, Controller, Get, Param, Patch, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { IdentityService } from '../identity';
import {
  ListAdminUsersQueryDto,
  UpdateAdminUserDto,
} from './dto/admin-users.dto';

@ApiTags('Admin Users')
@ApiBearerAuth()
@Roles(Role.ADMIN)
@Controller('admin/users')
export class AdminController {
  constructor(private readonly identityService: IdentityService) {}

  @Get()
  @ApiOperation({ summary: 'Admin: Danh sách người dùng' })
  listUsers(@Query() query: ListAdminUsersQueryDto) {
    return this.identityService.listUsersForAdmin(query);
  }

  @Patch(':id')
  @ApiOperation({
    summary: 'Admin: Cập nhật vai trò hoặc trạng thái người dùng',
  })
  updateUser(
    @Param('id') id: string,
    @Body() dto: UpdateAdminUserDto,
    @CurrentUser('userId') actorId: string,
  ) {
    return this.identityService.updateUserAccessForAdmin({
      targetUserId: id,
      actorId,
      roles: dto.roles,
      status: dto.status,
    });
  }
}
