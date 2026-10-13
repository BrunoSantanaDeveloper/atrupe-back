import { readdirSync, statSync } from 'fs';
import { join } from 'path';
import {
  GUARDS_METADATA,
  METHOD_METADATA,
  PATH_METADATA,
} from '@nestjs/common/constants';
import { HAS_PERMISSION_KEY } from './has-permission.decorator';
import { HAS_ANY_PERMISSION_KEY } from './has-any-permission.decorator';
import { PermissionsGuard } from './permissions.guard';
import { JwtAuthGuard } from '../guards/jwt.guard';
import { SystemAdminGuard } from '../guards/system-admin.guard';

/**
 * Cobertura da permissão no endpoint.
 *
 * 1. Toda rota com @HasPermission/@HasAnyPermission passa pelo
 *    PermissionsGuard depois do login: sem o guard, o decorator não confere
 *    nada, e o guard antes do login recusa todo mundo.
 * 2. No controller que confere permissão, toda rota tem chave, é do
 *    superadmin ou está em ROTAS_LIVRES com o motivo.
 * 3. O controller que não confere permissão está em CONTROLLERS_SEM_PERMISSAO
 *    com o motivo: o controller novo precisa decidir.
 */

const APOIO =
  'lista de apoio: lida pelos formulários e filtros de outros módulos';
const NO_HANDLER = 'permissão conferida no handler';
const SEM_LOGIN = 'fluxo de acesso sem login (cadastro, senha, verificação)';
const EXTERNO = 'consulta externa (CEP, CNPJ, documento), sem dado da empresa';

const ROTAS_LIVRES: Record<string, string> = {
  'AddressController.zipcode': EXTERNO,
  'AddressController.findClientAddresses': APOIO,
  'BankController.findAll': APOIO,
  'BankController.findAllByCondition': APOIO,
  'BankController.getBankAccountsInUse': APOIO,
  'BankController.listAccounts': APOIO,
  'BankController.findOne': APOIO,
  'CancelReasonController.findAll': APOIO,
  'ClientController.findOne': APOIO,
  'CompanyController.createMain':
    'cadastro: cria a empresa principal da conta nova',
  'CompanyController.findAll': APOIO,
  'ConditionController.findInUse': APOIO,
  'ConditionController.findAvailable': APOIO,
  'ConditionController.findAll': APOIO,
  'ConditionController.findDownPayment': APOIO,
  'ConditionController.findOne': APOIO,
  'ContactSourceController.findAll': APOIO,
  'CreditLimitController.findOne': APOIO,
  'EmployeeController.findAllQuantity': 'contagem da cota de usuários do plano',
  'EmployeeController.findAllFlat': APOIO,
  'FiscalOnboardingController.getStatus':
    'situação do onboarding fiscal da empresa, lida no menu',
  'MethodController.findAll': APOIO,
  'MethodController.findOne': APOIO,
  'NatureController.findAllSubNatures': APOIO,
  'NatureController.findAllSubNaturesLevel2': APOIO,
  'NatureController.findAllSubCategory': APOIO,
  'OperationNatureController.getAll': APOIO,
  'OrderController.create': NO_HANDLER,
  'OrderController.export': NO_HANDLER,
  'PaymentController.getPaymentConditionsInUse': APOIO,
  'ProductController.findAll': APOIO,
  'ProductController.findAllQuantity': APOIO,
  'ProductController.findOne': APOIO,
  'QuotationController.export': NO_HANDLER,
  'ReportController.findAll':
    'menu de relatórios conforme as permissões da sessão',
  'ReportController.getSalesPermissions':
    'menu de relatórios conforme as permissões da sessão',
  'RoleController.findAll': APOIO,
  'SaleSeriesController.findAll': APOIO,
  'SaleSeriesController.findOne': APOIO,
  'SectorController.findAll': APOIO,
  'StatusController.findAll': APOIO,
  'SupplierController.findOne': APOIO,
  'UnitOfMeasureController.findAll': APOIO,
  'UnitOfMeasureController.getCompanyUnitDefaults': APOIO,
  'UnitOfMeasureController.getCompanyDefaultUnits': APOIO,
  'UnitOfMeasureController.getVariantsByKind': APOIO,
  'UnitOfMeasureController.findByKind': APOIO,
  'UnitOfMeasureController.findOne': APOIO,
  'UserController.create': SEM_LOGIN,
  'UserController.me': 'dados da própria sessão',
  'UserController.check': EXTERNO,
  'UserController.findOne':
    'o próprio usuário, o superadmin ou a mesma empresa (conferido no service)',
  'UserController.forgotPassword': SEM_LOGIN,
  'UserController.resetPassword': SEM_LOGIN,
  'UserController.verifyEmail': SEM_LOGIN,
  'UserController.resendVerification': SEM_LOGIN,
  'UserController.createPassword': SEM_LOGIN,
};

const CONTROLLERS_SEM_PERMISSAO: Record<string, string> = {
  AppController: 'saúde da API',
  AcademyController: 'conteúdo de ajuda; a escrita é do superadmin',
  ActivityMonitorController: 'superadmin; o logout é da própria sessão',
  AiController:
    'assistente: conversas da própria sessão, com limite por usuário',
  AuthController: 'login e renovação da sessão',
  CategoryController: `${NO_HANDLER}, pelo tipo do grupo (CATEGORY_KIND_PERMISSION)`,
  CheckoutController: 'contratação',
  ContractController:
    'aceite do contrato pelo próprio usuário; criar é do superadmin',
  CouponsController: 'superadmin; validar cupom faz parte da contratação',
  CustomersController: 'superadmin',
  FilesController: 'upload de arquivo com login',
  InvoiceController: 'gera um PDF a partir do corpo, sem dado da empresa',
  LanguageController: 'stub sem banco',
  MigrationController: 'superadmin',
  OwnershipController: 'titularidade: as regras do titular ficam no service',
  OwnershipInviteController: 'convite de titularidade, com limite próprio',
  PaymentsController:
    'cobranças da assinatura da conta (empresa conferida); estorno e cancelamento do superadmin',
  PlanConfigController: 'superadmin',
  PlanController:
    'superadmin; as rotas públicas mostram os planos na contratação',
  SellersController: APOIO,
  SubscriptionsController:
    'assinatura da própria conta; as rotas de administração são do superadmin',
  SystemSettingsController: 'superadmin',
  UtilsController: EXTERNO,
  WebhooksController:
    'webhook do provedor (token); reprocessar é do superadmin',
};

// Os controllers que leem configuração de armazenamento ao carregar
for (const key of [
  'S3_BUCKET',
  'S3_REGION',
  'S3_ACCESS_KEY',
  'S3_SECRET_ACCESS_KEY',
  'MINIO_ACCESS_KEY',
  'MINIO_SECRET_KEY',
  'MINIO_BUCKET_NAME',
]) {
  process.env[key] = process.env[key] || 'teste';
}
process.env.MINIO_ENDPOINT = process.env.MINIO_ENDPOINT || '127.0.0.1';
process.env.MINIO_PORT = process.env.MINIO_PORT || '9000';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'teste';
process.env.JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || 'teste';

const SRC = join(__dirname, '..', '..', '..');

function controllerFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return controllerFiles(path);
    return name.endsWith('.controller.ts') ? [path] : [];
  });
}

type Route = {
  key: string;
  guards: unknown[];
  hasPermission: boolean;
};

type ControllerInfo = { name: string; routes: Route[] };

const guardsOf = (target: object): unknown[] =>
  Reflect.getMetadata(GUARDS_METADATA, target) ?? [];

const controllers: ControllerInfo[] = controllerFiles(SRC).flatMap((file) => {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const exported = require(file);
  return Object.values(exported)
    .filter(
      (value): value is any =>
        typeof value === 'function' &&
        Reflect.getMetadata(PATH_METADATA, value) !== undefined,
    )
    .map((klass) => ({
      name: klass.name,
      routes: Object.getOwnPropertyNames(klass.prototype)
        .filter(
          (name) =>
            name !== 'constructor' &&
            Reflect.getMetadata(METHOD_METADATA, klass.prototype[name]) !==
              undefined,
        )
        .map((name) => {
          const handler = klass.prototype[name];
          return {
            key: `${klass.name}.${name}`,
            guards: [...guardsOf(klass), ...guardsOf(handler)],
            hasPermission:
              !!Reflect.getMetadata(HAS_PERMISSION_KEY, handler) ||
              !!Reflect.getMetadata(HAS_ANY_PERMISSION_KEY, handler),
          };
        }),
    }));
});

const usesPermissions = (controller: ControllerInfo) =>
  controller.routes.some((route) => route.guards.includes(PermissionsGuard));

const routes = controllers.flatMap((controller) => controller.routes);

describe('cobertura da permissão no endpoint', () => {
  it('a varredura acha os controllers', () => {
    expect(controllers.length).toBeGreaterThan(60);
  });

  it.each(
    routes
      .filter((route) => route.hasPermission)
      .map((route) => [route.key, route]),
  )('%s: PermissionsGuard depois do login', (_key, route: Route) => {
    const permissions = route.guards.indexOf(PermissionsGuard);
    expect({ route: route.key, permissionsGuard: permissions >= 0 }).toEqual({
      route: route.key,
      permissionsGuard: true,
    });
    expect(route.guards.indexOf(JwtAuthGuard)).toBeGreaterThanOrEqual(0);
    expect(route.guards.indexOf(JwtAuthGuard)).toBeLessThan(permissions);
  });

  it('nos controllers que conferem permissão, toda rota decidiu', () => {
    const undecided = controllers
      .filter(usesPermissions)
      .flatMap((controller) => controller.routes)
      .filter(
        (route) =>
          !route.hasPermission &&
          !route.guards.includes(SystemAdminGuard) &&
          !ROTAS_LIVRES[route.key],
      )
      .map((route) => route.key);
    expect(undecided).toEqual([]);
  });

  it('as rotas livres existem e continuam sem chave', () => {
    const byKey = new Map(routes.map((route) => [route.key, route]));
    const stale = Object.keys(ROTAS_LIVRES).filter(
      (key) => !byKey.has(key) || byKey.get(key)!.hasPermission,
    );
    expect(stale).toEqual([]);
  });

  it('todo controller sem permissão no endpoint tem o motivo', () => {
    const missing = controllers
      .filter((controller) => !usesPermissions(controller))
      .map((controller) => controller.name)
      .filter((name) => !CONTROLLERS_SEM_PERMISSAO[name]);
    expect(missing).toEqual([]);
  });

  it('a lista de controllers sem permissão não tem sobra', () => {
    const stale = Object.keys(CONTROLLERS_SEM_PERMISSAO).filter((name) => {
      const controller = controllers.find((c) => c.name === name);
      return !controller || usesPermissions(controller);
    });
    expect(stale).toEqual([]);
  });
});
