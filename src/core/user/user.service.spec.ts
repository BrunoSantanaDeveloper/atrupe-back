import { Test, TestingModule } from '@nestjs/testing';
import { UserService } from './user.service';
import { ConflictException } from '@nestjs/common';
import * as argon2 from 'argon2';
import { PrismaService } from 'nestjs-prisma';
import { PrismaClientKnownRequestError } from '@prisma/client/runtime/library';

describe('UserService', () => {
  let userService: UserService;
  let prismaService: PrismaService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UserService,
        {
          provide: PrismaService,
          useValue: {
            user: {
              create: jest.fn(),
            },
          },
        },
      ],
    }).compile();

    userService = module.get<UserService>(UserService);
    prismaService = module.get<PrismaService>(PrismaService);
  });

  it('should throw ConflictException if email already exists', async () => {
    const createUserDto = {
      name: 'Test User',
      email: 'test@example.com',
      password: 'password123',
    };

    jest.spyOn(prismaService.user, 'create').mockRejectedValue(
      new PrismaClientKnownRequestError('Email already exists', {
        code: 'P2002',
        clientVersion: '',
      }),
    );

    await expect(userService.create(createUserDto)).rejects.toThrow(
      ConflictException,
    );
  });

  it('should hash the password before saving', async () => {
    const createUserDto = {
      name: 'Test User',
      email: 'test@example.com',
      password: 'password123',
    };
    const fakeHashedPassword = 'fakeHashedPassword123';

    jest.spyOn(argon2, 'hash').mockResolvedValue(fakeHashedPassword);

    const expectedUser = {
      ...createUserDto,
      password: fakeHashedPassword,
      createdAt: new Date(),
      updatedAt: new Date(),
      id: '',
    };

    jest.spyOn(prismaService.user, 'create').mockResolvedValue(expectedUser);

    const result = await userService.create(createUserDto);

    expect(argon2.hash).toHaveBeenCalledWith(createUserDto.password);
    expect(result.password).toEqual(fakeHashedPassword);
    expect(result).toEqual(expectedUser);
  });
});
