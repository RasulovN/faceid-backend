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
  Req,
  Res,
} from '@nestjs/common';
import { ApiBearerAuth, ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import { FastifyReply, FastifyRequest } from 'fastify';
import { EmployeesService } from './employees.service';
import { EmployeesImportService } from './employees-import.service';
import {
  CreateEmployeeDto,
  EmployeeAttendanceQueryDto,
  EmployeeListQueryDto,
  UpdateEmployeeDto,
  UpdateEmployeeStatusDto,
} from './dto/employee.dtos';
import { CurrentUser, Permissions, RequestUser, SkipEnvelope } from '../../common/decorators';
import { PERMISSIONS, roleHasPermission } from '../../common/constants/permissions';
import { PersonType, UserRole } from '../../common/enums';
import { AppException } from '../../common/exceptions/app.exception';
import { parseMultipart } from '../../common/utils/multipart.util';

@ApiTags('employees')
@ApiBearerAuth()
@Controller('employees')
export class EmployeesController {
  constructor(
    private readonly employeesService: EmployeesService,
    private readonly importService: EmployeesImportService,
  ) {}

  @Get()
  @Permissions(PERMISSIONS.EMPLOYEES_READ)
  async findAll(@CurrentUser() user: RequestUser, @Query() query: EmployeeListQueryDto) {
    return this.employeesService.findAll(user.companyId!, query);
  }

  @Post()
  @Permissions(PERMISSIONS.EMPLOYEES_CREATE)
  @ApiOperation({ summary: 'Xodim yaratish (User + Employee bitta tranzaksiyada)' })
  async create(@CurrentUser() user: RequestUser, @Body() dto: CreateEmployeeDto) {
    return this.employeesService.create(user.companyId!, dto);
  }

  @Get('import/template')
  @Permissions(PERMISSIONS.EMPLOYEES_CREATE)
  @SkipEnvelope()
  @ApiOperation({
    summary:
      'Ommaviy import Excel shabloni (.xlsx). ?type=STUDENT — o‘quvchilar shabloni',
  })
  async importTemplate(
    @CurrentUser() user: RequestUser,
    @Res() reply: FastifyReply,
    @Query('type') type?: string,
  ) {
    const personType = type === PersonType.STUDENT ? PersonType.STUDENT : PersonType.EMPLOYEE;
    const buffer = await this.importService.buildTemplate(user.companyId!, personType);
    const filename =
      personType === PersonType.STUDENT ? 'oquvchilar-shablon.xlsx' : 'xodimlar-shablon.xlsx';
    void reply
      .header('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
      .header('Content-Disposition', `attachment; filename="${filename}"`)
      .send(buffer);
  }

  @Post('import')
  @Permissions(PERMISSIONS.EMPLOYEES_CREATE)
  @ApiConsumes('multipart/form-data')
  @ApiOperation({
    summary:
      "Excel (.xlsx) fayldan ommaviy import — har qator bo'yicha natija. ?type=STUDENT — o'quvchilar",
  })
  async import(
    @CurrentUser() user: RequestUser,
    @Req() req: FastifyRequest,
    @Query('type') type?: string,
  ) {
    const { files } = await parseMultipart(req, { maxFiles: 1, imagesOnly: false });
    if (files.length === 0) {
      throw AppException.validation('Excel (.xlsx) fayl biriktiring');
    }
    const personType = type === PersonType.STUDENT ? PersonType.STUDENT : PersonType.EMPLOYEE;
    return this.importService.import(user.companyId!, files[0], personType);
  }

  @Get(':id')
  @Permissions(PERMISSIONS.EMPLOYEES_READ)
  async findOne(@CurrentUser() user: RequestUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.employeesService.findOne(user.companyId!, id);
  }

  @Patch(':id')
  @Permissions(PERMISSIONS.EMPLOYEES_UPDATE)
  async update(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateEmployeeDto,
  ) {
    return this.employeesService.update(user.companyId!, id, dto);
  }

  @Delete(':id')
  @Permissions(PERMISSIONS.EMPLOYEES_DELETE)
  @ApiOperation({ summary: 'Soft delete — bog‘liq User ham deaktiv bo‘ladi' })
  async remove(@CurrentUser() user: RequestUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.employeesService.remove(user.companyId!, id);
  }

  @Post(':id/photos')
  @Permissions(PERMISSIONS.EMPLOYEES_UPDATE)
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ summary: '1–5 rasm → MinIO → face-service /extract → FaceEmbedding' })
  async addPhotos(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: FastifyRequest,
  ) {
    const { files } = await parseMultipart(req, { maxFiles: 5, imagesOnly: true });
    return this.employeesService.addPhotos(user.companyId!, id, files);
  }

  @Delete(':id/photos/:embeddingId')
  @Permissions(PERMISSIONS.EMPLOYEES_UPDATE)
  async removePhoto(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('embeddingId', ParseUUIDPipe) embeddingId: string,
  ) {
    return this.employeesService.removePhoto(user.companyId!, id, embeddingId);
  }

  @Patch(':id/status')
  @Permissions(PERMISSIONS.EMPLOYEES_UPDATE)
  async updateStatus(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateEmployeeStatusDto,
  ) {
    return this.employeesService.updateStatus(user.companyId!, id, dto);
  }

  @Get(':id/attendance')
  @ApiOperation({
    summary:
      'Xodimning kunlik davomati: har kun uchun { date, workDay|null, events[] }. EMPLOYEE faqat o‘zinikini ko‘radi',
  })
  async attendance(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: EmployeeAttendanceQueryDto,
  ) {
    if (user.role === UserRole.EMPLOYEE) {
      await this.employeesService.assertOwnEmployee(user.companyId!, id, user.id);
    } else if (!roleHasPermission(user.role, PERMISSIONS.EMPLOYEES_READ)) {
      throw AppException.forbidden('Sizda employees.read ruxsati yo‘q');
    }
    return this.employeesService.attendance(user.companyId!, id, query);
  }
}
