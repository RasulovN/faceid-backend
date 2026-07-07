import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { BranchesService } from './branches.service';
import { CreateBranchDto, UpdateBranchDto } from './dto/branch.dtos';
import { CurrentUser, Permissions, RequestUser } from '../../common/decorators';
import { PERMISSIONS } from '../../common/constants/permissions';
import { PaginationDto } from '../../common/dto/pagination.dto';

@ApiTags('branches')
@ApiBearerAuth()
@Controller('branches')
export class BranchesController {
  constructor(private readonly branchesService: BranchesService) {}

  @Get()
  @Permissions(PERMISSIONS.BRANCHES_READ)
  async findAll(@CurrentUser() user: RequestUser, @Query() query: PaginationDto) {
    return this.branchesService.findAll(user.companyId!, query);
  }

  @Post()
  @Permissions(PERMISSIONS.BRANCHES_CREATE)
  async create(@CurrentUser() user: RequestUser, @Body() dto: CreateBranchDto) {
    return this.branchesService.create(user.companyId!, dto);
  }

  @Get(':id')
  @Permissions(PERMISSIONS.BRANCHES_READ)
  async findOne(@CurrentUser() user: RequestUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.branchesService.findOne(user.companyId!, id);
  }

  @Patch(':id')
  @Permissions(PERMISSIONS.BRANCHES_UPDATE)
  async update(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateBranchDto,
  ) {
    return this.branchesService.update(user.companyId!, id, dto);
  }

  @Delete(':id')
  @Permissions(PERMISSIONS.BRANCHES_DELETE)
  async remove(@CurrentUser() user: RequestUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.branchesService.remove(user.companyId!, id);
  }
}
