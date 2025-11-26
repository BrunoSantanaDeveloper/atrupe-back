import {
  Controller,
  Post,
  Body,
  UseGuards,
  Req,
  Get,
  Param,
  Patch,
  Delete,
  Query,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiParam,
} from '@nestjs/swagger';
import { SubscriptionsService } from './subscriptions.service';
import { CreateSubscriptionDto } from './dto/create-subscription.dto';
import { UpgradeSubscriptionDto } from './dto/upgrade-subscription.dto';
import { ListTrialCompaniesDto } from './dto/list-trial-companies.dto';
import { ListIncompleteRegistrationsDto } from './dto/list-incomplete-registrations.dto';
import { JwtAuthGuard } from '../auth/guards/jwt.guard';

@ApiTags('subscriptions')
@Controller('subscriptions')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class SubscriptionsController {
  constructor(private readonly subscriptionsService: SubscriptionsService) {}

  @Get('incomplete-registrations')
  @ApiOperation({
    summary: 'List incomplete registrations (unverified emails)',
  })
  @ApiResponse({
    status: 200,
    description: 'List of incomplete registrations',
  })
  async listIncompleteRegistrations(
    @Query() query: ListIncompleteRegistrationsDto,
  ) {
    return await this.subscriptionsService.listIncompleteRegistrations(
      query.page,
      query.limit,
    );
  }

  @Get('trial-companies/totals')
  @ApiOperation({ summary: 'Get trial subscriptions totals by status' })
  @ApiResponse({
    status: 200,
    description: 'Trial subscriptions totals',
  })
  async getTrialTotals() {
    return await this.subscriptionsService.getTrialTotals();
  }

  @Get('trial-companies')
  @ApiOperation({ summary: 'List all companies with trial subscriptions' })
  @ApiResponse({
    status: 200,
    description: 'List of companies with trial subscriptions',
  })
  async listTrialCompanies(@Query() query: ListTrialCompaniesDto) {
    return await this.subscriptionsService.listTrialCompanies(
      query.page,
      query.limit,
      query.status,
    );
  }

  @Get('active')
  @ApiOperation({ summary: 'Get active subscription for company' })
  @ApiResponse({
    status: 200,
    description: 'Active subscription found',
  })
  @ApiResponse({ status: 404, description: 'No active subscription found' })
  async getActive(@Req() req) {
    return await this.subscriptionsService.findActiveByCompanyId(
      req.user.companyId,
    );
  }

  @Post()
  @ApiOperation({ summary: 'Create a new subscription' })
  @ApiResponse({
    status: 201,
    description: 'Subscription created successfully',
  })
  @ApiResponse({ status: 400, description: 'Bad request' })
  @ApiResponse({ status: 404, description: 'Customer or Plan not found' })
  async create(
    @Body() createSubscriptionDto: CreateSubscriptionDto,
    @Req() req,
  ) {
    createSubscriptionDto.companyId = req.user.companyId;
    return await this.subscriptionsService.create(createSubscriptionDto, req);
  }

  @Patch(':id/upgrade')
  @ApiOperation({ summary: 'Upgrade subscription to a new plan' })
  @ApiParam({ name: 'id', description: 'Subscription ID' })
  @ApiResponse({
    status: 200,
    description: 'Subscription upgraded successfully',
  })
  @ApiResponse({ status: 400, description: 'Bad request' })
  @ApiResponse({ status: 404, description: 'Subscription or Plan not found' })
  async upgrade(
    @Param('id') subscriptionId: string,
    @Body() upgradeDto: UpgradeSubscriptionDto,
    @Req() req,
  ) {
    return await this.subscriptionsService.upgrade(
      subscriptionId,
      upgradeDto.planId,
      req,
    );
  }

  @Patch(':id/modules/:moduleId')
  @ApiOperation({ summary: 'Add module to subscription' })
  @ApiParam({ name: 'id', description: 'Subscription ID' })
  @ApiParam({ name: 'moduleId', description: 'Module ID to add' })
  @ApiResponse({
    status: 200,
    description: 'Module added successfully',
  })
  @ApiResponse({ status: 400, description: 'Bad request' })
  @ApiResponse({ status: 404, description: 'Subscription or Module not found' })
  async addModule(
    @Param('id') subscriptionId: string,
    @Param('moduleId') moduleId: string,
    @Req() req,
  ) {
    return await this.subscriptionsService.addModule(
      subscriptionId,
      moduleId,
      req,
    );
  }

  @Delete(':id/modules/:moduleId')
  @ApiOperation({ summary: 'Remove module from subscription' })
  @ApiParam({ name: 'id', description: 'Subscription ID' })
  @ApiParam({ name: 'moduleId', description: 'Module ID to remove' })
  @ApiResponse({
    status: 200,
    description: 'Module removed successfully',
  })
  @ApiResponse({ status: 400, description: 'Bad request' })
  @ApiResponse({ status: 404, description: 'Subscription or Module not found' })
  async removeModule(
    @Param('id') subscriptionId: string,
    @Param('moduleId') moduleId: string,
    @Req() req,
  ) {
    return await this.subscriptionsService.removeModule(
      subscriptionId,
      moduleId,
      req,
    );
  }
}
