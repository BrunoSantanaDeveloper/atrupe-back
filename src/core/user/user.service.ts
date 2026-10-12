import { Injectable } from '@nestjs/common';
import {
  CreateMailVerificationDto,
  CreateUserByEmployeeDto,
  CreateUserDto,
} from './dto/create.dto';
import { CompleteRegistrationDto } from './dto/complete-registration.dto';
import { EditClientDto } from './dto/edit-client.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { UserCrudService } from './user-crud.service';
import { UserPasswordService } from './user-password.service';
import { UserRegistrationService } from './user-registration.service';
import { UserOnboardingService } from './user-onboarding.service';

/**
 * Facade that delegates to specialized sub-services.
 * Kept for backward compatibility with AuthService and module exports.
 */
@Injectable()
export class UserService {
  constructor(
    private readonly crud: UserCrudService,
    private readonly password: UserPasswordService,
    private readonly registration: UserRegistrationService,
    private readonly onboarding: UserOnboardingService,
  ) {}

  // --- Registration ---

  sendEmailValidation(
    email: string,
    name?: string,
    companyName?: string,
    phone?: string,
  ) {
    return this.registration.sendEmailValidation(
      email,
      name,
      companyName,
      phone,
    );
  }

  verifyEmail(body: { email: string; token: string }) {
    return this.registration.verifyEmail(body);
  }

  createPassword(createUserDto: CreateUserDto) {
    return this.registration.createPassword(createUserDto);
  }

  create(createUserDto: CreateMailVerificationDto): Promise<any> {
    return this.registration.create(createUserDto);
  }

  createUserForEmployee(
    createUserDto: CreateUserByEmployeeDto,
    createdByUserId?: string,
    createdByUserName?: string,
  ): Promise<any> {
    return this.registration.createUserForEmployee(
      createUserDto,
      createdByUserId,
      createdByUserName,
    );
  }

  // --- CRUD ---

  findAll() {
    return this.crud.findAll();
  }

  findOneRoles(id: string) {
    return this.crud.findOneRoles(id);
  }

  findOne(id: string) {
    return this.crud.findOne(id);
  }

  findOneForActor(id: string, actor: any) {
    return this.crud.findOneForActor(id, actor);
  }

  check(doc: string) {
    return this.crud.check(doc);
  }

  findByEmail(email: string) {
    return this.crud.findByEmail(email);
  }

  update(id: string, updateUserDto: UpdateUserDto, actor?: any) {
    return this.crud.update(id, updateUserDto, actor);
  }

  // --- Password ---

  forgotPassword(forgotPasswordDto: ForgotPasswordDto): Promise<string> {
    return this.password.forgotPassword(forgotPasswordDto);
  }

  resetPassword(resetPasswordDto: ResetPasswordDto): Promise<void> {
    return this.password.resetPassword(resetPasswordDto);
  }

  adminPasswordReset(
    targetUserId: string,
    adminUserId: string,
    adminPassword: string,
  ): Promise<void> {
    return this.password.adminPasswordReset(
      targetUserId,
      adminUserId,
      adminPassword,
    );
  }

  adminGeneratePassword(
    targetUserId: string,
    adminUserId: string,
    adminPassword: string,
  ): Promise<{ temporaryPassword: string }> {
    return this.password.adminGeneratePassword(
      targetUserId,
      adminUserId,
      adminPassword,
    );
  }

  // --- Onboarding ---

  completeRegistration(
    completeRegistrationDto: CompleteRegistrationDto,
    adminUserId: string,
  ) {
    return this.onboarding.completeRegistration(
      completeRegistrationDto,
      adminUserId,
    );
  }

  editClient(editClientDto: EditClientDto, adminUserId: string) {
    return this.onboarding.editClient(editClientDto, adminUserId);
  }
}
