# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Development Commands

### Core Commands
- `npm install` - Install dependencies
- `npm run build` - Build the NestJS application
- `npm run start:dev` - Run in development mode with watch
- `npm run start:prod` - Run in production mode
- `npm run lint` - Run ESLint with fixes
- `npm test` - Run Jest tests
- `npm run test:e2e` - Run end-to-end tests

### Make Commands (Preferred)
- `make setup` - Install dependencies and setup .env file
- `make run` - Start with Docker Compose
- `make logs` - View Docker logs
- `make stop` - Stop Docker services
- `make migrate` - Run Prisma migrations
- `make format-db` - Format Prisma schema

### Database Operations
- `npx prisma generate` - Generate Prisma client
- `npx prisma migrate dev` - Run migrations in development
- `DATABASE_URL=$(DATABASE_URL_EXTERNAL) npx prisma migrate dev --name [name]` - Run migration with external DB
- `npx prisma format` - Format schema file

## Architecture Overview

### Core Structure
This is a **NestJS-based API** for the Atrupe business management system. The application uses:

- **Database**: PostgreSQL with Prisma ORM
- **Authentication**: JWT with Passport strategies
- **Authorization**: ABAC (Attribute-Based Access Control) system
- **Containerization**: Docker and Docker Compose
- **Documentation**: Swagger/OpenAPI

### Module Organization

#### Core Business Modules (`src/core/`)
- **Company Management**: Companies, sectors, employees, roles
- **Financial System**: Payables, receivables, cash control, invoices, financial flows
- **Sales Management**: Quotations, orders, delivery schedules, payment conditions
- **Inventory**: Products, categories, units of measure, suppliers
- **Authentication & Authorization**: JWT auth with role-based permissions
- **Plan Control**: Subscription plans with feature/limit enforcement

#### Service Modules (`src/svc/`)
- **External Integrations**: BrasilAPI, BigDataCorp for company/address data
- **File Management**: AWS S3/MinIO integration
- **Reporting**: PDF generation with PuppeteeR
- **Caching**: Redis-based caching layer
- **Utilities**: Common helper services

### Plan & Feature System

This application implements a **sophisticated subscription plan system** with dynamic feature and limit enforcement:

- **Decorators**: `@RequiresFeature`, `@RequiresLimit`, `@TrialRestricted`
- **Guards**: Feature, limit, and trial validation guards
- **Dynamic System**: Features and limits are database-driven, not hardcoded
- **Trial Management**: Companies can have trial periods with restricted access

### Key Architectural Patterns

#### Database Schema Design
- Uses **Prisma ORM** with PostgreSQL
- **Company-centric**: Most entities are tied to companies for multi-tenancy
- **Subscription Model**: Complex subscription system with plans, features, and limits
- **Financial Tracking**: Comprehensive financial flow tracking with multiple payment methods

#### Authentication Flow
1. Local strategy for username/password
2. JWT strategy for API protection
3. ABAC system for fine-grained permissions
4. Company-based data isolation

#### Module Dependencies
- `CoreModule` - Main business logic container
- `PrismaModule` - Database connection and client
- `ConfigModule` - Environment configuration (global)
- Service modules are loosely coupled and can be used independently

## Important Development Guidelines

### Database Migrations
⚠️ **CRITICAL**: Never let AI manipulate the database directly!

1. Always create schema changes in a separate file first
2. Review all relationships carefully before applying
3. Always commit after successful migrations
4. Keep project updated to avoid migration conflicts
5. Use `npx prisma migrate dev` for development migrations

### Testing
- Unit tests with Jest (configured in package.json)
- E2E tests in `test/` directory
- Run tests before committing (enforced by husky/lint-staged)

### Plan System Usage
When working with plan restrictions:
- Check existing decorators in `src/core/plan/decorators/`
- Use `PlanControlService` for runtime plan validation
- Features and limits are dynamic - check database for current configuration

### Docker Development
- Use `make run` or `docker-compose up` for local development
- Environment variables must be exported to bash before Docker commands
- API available at `http://localhost:5000` (or configured port)
- Swagger docs at `http://localhost:{PORT}/doc`

## File Structure Patterns

- **DTOs**: `dto/` folders contain request/response data transfer objects
- **Entities**: `entities/` folders contain database entity definitions
- **Controllers**: Handle HTTP routes and request validation
- **Services**: Contain business logic and database operations
- **Modules**: Wire together controllers, services, and dependencies

## External Integrations

- **BrasilAPI**: Company data, CEP lookup, CNPJ validation
- **BigDataCorp**: Enhanced company information
- **AWS S3/MinIO**: File storage and management
- **Email**: Nodemailer with Handlebars templates