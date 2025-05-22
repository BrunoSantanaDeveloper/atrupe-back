import {
  Injectable,
  NotFoundException,
  ConflictException,
  InternalServerErrorException,
} from '@nestjs/common';
import { AcceptContractDto, CreateContractDto } from './dtos';
import { PrismaService } from 'nestjs-prisma';
import * as path from 'path';
import * as fs from 'fs';
import * as mammoth from 'mammoth';
import { Response } from 'express';

@Injectable()
export class ContractService {
  constructor(private readonly prisma: PrismaService) {}

  async findContract(res: Response) {
    try {
      const filePath = path.join(process.cwd(), 'src', 'assets', 'terms.docx');

      const fileBuffer = await fs.promises.readFile(filePath);

      const result = await mammoth.convertToHtml({ buffer: fileBuffer });
      const html = result.value;

      res.setHeader('Content-Type', 'application/json');
      res.send({
        html,
      });
    } catch (readError) {
      console.error('Error reading or converting file:', readError);
      throw new NotFoundException('Error processing terms document');
    }
  }

  async acceptContract(acceptContractData: AcceptContractDto) {
    try {
      const { userId, contractId, ipAddress, userAgent } = acceptContractData;

      const contract = await this.prisma.contract.findUnique({
        where: {
          id: contractId,
        },
      });

      if (!contract) {
        throw new NotFoundException('Contract not found');
      }

      const existingAcceptance = await this.prisma.userContract.findUnique({
        where: {
          userId_contractId: {
            userId,
            contractId,
          },
        },
      });

      if (existingAcceptance) {
        return existingAcceptance;
      }

      const userContract = await this.prisma.userContract.create({
        data: {
          userId,
          contractId,
          ipAddress,
          userAgent,
        },
      });

      return userContract;
    } catch (error) {
      console.log(error);
      throw new InternalServerErrorException('Error accepting contract');
    }
  }

  async createContract(createContractData: CreateContractDto) {
    const { title, content, version } = createContractData;

    const existingContract = await this.prisma.contract.findFirst({
      where: {
        version,
      },
    });

    if (existingContract) {
      throw new ConflictException(
        'A contract with this version already exists',
      );
    }

    const contract = await this.prisma.contract.create({
      data: {
        name: title,
        contentUrl: content,
        version,
      },
    });

    return contract;
  }
}
