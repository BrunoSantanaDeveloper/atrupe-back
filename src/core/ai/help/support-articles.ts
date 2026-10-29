// Gerado por openspec/suporte/gerar.mjs a partir de base-start.json.
// Não editar aqui: a base de suporte é a mesma do atendimento pelo WhatsApp.
import type { HelpProcess } from '../ai-help-content.service';

export const SUPPORT_ARTICLES: HelpProcess[] = [
  {
    id: 'start_primeiros_passos',
    title: 'Por onde começar no Start',
    summary:
      'O Start é configurado em uma ordem: empresa, produtos, cadastros, vendas e financeiro. Seguir a ordem do Atrupe Academy evita retrabalho.',
    keywords: [
      'por onde comeco',
      'como configurar o sistema',
      'primeiros passos',
      'como funciona o academy',
      'manual do start',
    ],
    paths: ['/academy/start'],
    steps: [
      'Abra **Academy › Start** no menu e siga os itens na ordem: Empresa e sistema, Produtos, Clientes, Fornecedores, Configurações de vendas, Orçamentos, Ordens de serviço, Configurações do financeiro.',
      'Faça cada etapa no sistema logo depois de ver o vídeo ou o material, e marque o item como concluído.',
      'Use a série **T1 – Treinamento** para os orçamentos de teste. Depois troque a série padrão para a de vendas reais (veja "Séries de venda").',
    ],
    notes: [
      'O Academy abre como página inicial: dá para desligar isso no próprio Academy (Habilitar/desabilitar Academy).',
      'Material de uma tela específica: use o botão de ajuda no canto superior direito da tela.',
    ],
  },
  {
    id: 'empresa_dados_e_marca',
    title: 'Dados da empresa, logo e textos da proposta',
    summary:
      'Os dados, o endereço, a logo e os textos que aparecem na proposta comercial ficam no cadastro da empresa.',
    keywords: [
      'como colocar minha logo',
      'mudar dados da empresa',
      'texto da proposta',
      'condicoes comerciais no orcamento',
      'endereco da empresa',
    ],
    paths: ['/configuracoes/empresa-e-sistema'],
    steps: [
      'Abra **Configurações › Empresa e sistema** e entre em **Configuração da empresa**.',
      'Preencha os dados da empresa, o endereço e as redes sociais.',
      'Em **Personalizar empresa**, envie a marca e o ícone nos formatos indicados na tela.',
      'Ajuste o **texto antes dos itens** (apresentação) e o **texto depois dos itens** (condições comerciais) e confira na pré-visualização da proposta.',
    ],
    notes: [
      'A logo sai distorcida: use o formato e a proporção pedidos na tela.',
    ],
    permissions: [
      {
        action: 'view',
        resource: 'company_settings:company',
      },
    ],
  },
  {
    id: 'setores',
    title: 'Setores',
    summary:
      'Os setores organizam os produtos e são o primeiro filtro ao adicionar um item no orçamento. Também aparecem no relatório de resultado por setor.',
    keywords: [
      'como criar setor',
      'renomear setor',
      'desativar setor',
      'produtos sumiram do orcamento',
      'setor no orcamento',
    ],
    paths: ['/configuracoes/empresa-e-sistema'],
    steps: [
      'Abra **Configurações › Empresa e sistema › Setores**.',
      'Ligue os setores que a empresa usa e desligue os que não usa. Os setores administrativos não desligam.',
      'Para mudar o nome, a cor ou o ícone, edite o setor e salve ("Setor atualizado").',
    ],
    notes: [
      'Não há botão de criar setor: renomeie um setor que a empresa não usa (por exemplo, "Frota" para "Veículos").',
      'Ao desligar um setor, os produtos dele ficam inativos. Religar o setor não reativa os produtos: é preciso reativar cada produto na aba Inativos de Produtos.',
    ],
    permissions: [
      {
        action: 'view',
        resource: 'company_settings:sectors',
      },
    ],
  },
  {
    id: 'padrao_de_medida',
    title: 'Padrão de medida',
    summary:
      'Define as unidades que a empresa usa: comprimento em metro, centímetro ou milímetro; peso em quilo, grama ou miligrama; volume em litro ou mililitro.',
    keywords: [
      'medida em centimetro',
      'mudar unidade de medida',
      'padrao de medida',
    ],
    paths: ['/configuracoes/empresa-e-sistema'],
    steps: [
      'Abra **Configurações › Empresa e sistema › Padrão de medida**.',
      'Escolha a unidade de comprimento, de peso e de volume e salve.',
    ],
    permissions: [
      {
        action: 'view',
        resource: 'company_settings:measurement_standards',
      },
    ],
  },
  {
    id: 'usuarios_e_cargos',
    title: 'Colaboradores, usuários e cargos (permissões)',
    summary:
      'Cada pessoa da equipe é um colaborador. Quem acessa o sistema também tem um usuário. O cargo define o que cada um pode ver, editar, excluir e exportar.',
    keywords: [
      'como criar usuario',
      'adicionar funcionario',
      'limite de usuarios',
      'permissao do vendedor',
      'cargo',
      'funcionario nao ve tela',
      'senha do usuario',
      'assinatura no orcamento',
    ],
    paths: ['/configuracoes/empresa-e-sistema/colaboradores-e-usuarios'],
    steps: [
      'Abra **Configurações › Empresa e sistema › Colaboradores e usuários**.',
      'Cadastre o colaborador com nome, setor e cargo. Pelo lápis, complete foto, endereço e a **assinatura para orçamentos** (imagem PNG com fundo transparente, até 50 KB, cerca de 600 × 250 px).',
      'Para dar acesso ao sistema, crie o usuário do colaborador com e-mail e senha.',
      'Em **Cargos**, crie ou edite o cargo e abra **Permissões do cargo** para marcar o que ele visualiza, edita, exclui e exporta. Clique em **Salvar** no fim, senão as permissões não ficam gravadas.',
      'Quem vende também precisa estar num perfil de vendedor (veja "Perfil de vendedor").',
    ],
    notes: [
      '"Limite do plano atingido": o Start tem até 3 usuários com acesso. Inative um usuário que não usa mais ou contrate mais usuários (o administrador principal vê "Ver planos").',
      'A senha precisa ter pelo menos 8 caracteres, com letra maiúscula, letra minúscula, número e caractere especial.',
      'Não consigo excluir o cargo: há colaboradores nele. Troque o cargo dessas pessoas antes.',
      'O funcionário não vê uma tela ou um botão: falta a permissão no cargo dele. Valores em dinheiro (financeiro, relatórios, preços) só aparecem para cargos com a permissão de ver valores.',
      'Colaborador reativado não entra no sistema: ative também o usuário dele.',
    ],
    permissions: [
      {
        action: 'view',
        resource: 'company_settings:users',
      },
      {
        action: 'view',
        resource: 'company_settings:roles',
      },
    ],
  },
  {
    id: 'senha_e_acesso',
    title: 'Esqueci a senha ou não consigo entrar',
    summary:
      'A senha é recuperada pela própria tela de entrada, pelo e-mail do usuário.',
    keywords: [
      'esqueci minha senha',
      'nao consigo entrar',
      'trocar senha',
      'recuperar acesso',
    ],
    paths: ['/login'],
    steps: [
      'Na tela de entrada, clique em **Esqueci minha senha**.',
      'Informe o e-mail do usuário e siga o link que chega por e-mail.',
      'Se o e-mail não chegar, confira a caixa de spam. O administrador da empresa também pode trocar a senha do usuário em Colaboradores e usuários.',
    ],
    notes: [
      'Usuário inativado não entra: o administrador reativa em Colaboradores e usuários.',
      'Nunca envie a senha pelo WhatsApp: o suporte não precisa dela.',
    ],
  },
  {
    id: 'produtos_cadastrar',
    title: 'Cadastrar e editar produtos',
    summary:
      'No Start, o produto tem nome, código, a forma de venda (m², unidade, metro, hora, litro…) e o preço de venda. O sistema já vem com produtos de exemplo, separados por setor.',
    keywords: [
      'como cadastrar produto',
      'novo produto',
      'preco do produto',
      'produto por metro quadrado',
      'editar produto',
      'codigo do produto',
      'permitir editar valor',
      'descritivo tecnico',
      'inativar produto',
      'duplicar produto',
    ],
    paths: ['/configuracoes/produtos'],
    steps: [
      'Abra **Cadastros › Produtos**. Comece editando os produtos de exemplo antes de criar novos.',
      'Clique em **Novo produto** (ou no lápis de um produto).',
      'Escolha o **Setor** e o **Grupo de produtos** (dá para criar um grupo na hora em "Novo grupo neste setor").',
      'Informe o **Nome do produto** e o **Código** (uma abreviação curta).',
      'Escolha a **unidade comercial** e informe o preço de venda nessa unidade. Se não for por unidade, preencha o **Padrão de medidas do produto** (largura e altura, por exemplo), que já vem preenchido no orçamento.',
      'Se quiser, envie a imagem, escreva o **Descritivo técnico** e ligue **Permitir editar valor** e **Permitir editar descrição** para o vendedor poder ajustar no orçamento.',
      'Clique em **Salvar** ("Produto criado" ou "Produto atualizado").',
    ],
    notes: [
      '"O código X é do produto Y": o código já está em uso, inclusive por um produto inativo. Use outro código ou reative o produto indicado (aba Inativos).',
      '"Verifique os campos obrigatórios do produto": falta setor, grupo, nome, código ou unidade. O campo com erro fica marcado em vermelho.',
      'O produto não aparece no orçamento: ele está inativo, ou está em outro setor. No orçamento, o setor é escolhido antes do produto.',
      'Para vender algo que não está cadastrado, use o **Produto base** do setor, que permite editar valor e descrição no orçamento.',
      'Inativar não apaga: o produto sai dos novos orçamentos e fica na aba Inativos, onde pode ser reativado.',
    ],
    permissions: [
      {
        action: 'view',
        resource: 'product_settings:products',
      },
    ],
  },
  {
    id: 'produto_terceirizado',
    title: 'Produto terceirizado',
    summary:
      'Produto comprado de fornecedor e revendido. Ao aprovar a venda, o sistema gera a conta a pagar ao fornecedor com o custo informado no produto.',
    keywords: [
      'cadastrar produto terceirizado',
      'produto de fornecedor',
      'revenda',
      'custo do fornecedor',
      'nao consigo cadastrar terceirizado',
    ],
    paths: ['/configuracoes/produtos'],
    steps: [
      'Em **Cadastros › Produtos**, clique em **Produto terceirizado** (ou ligue a chave **Produto terceirizado** num produto).',
      'Preencha o produto como um produto comum (setor, grupo, nome, código, unidade e preço de venda).',
      'Escolha pelo menos um **Fornecedor** e informe o **Custo do fornecedor** na mesma unidade de venda.',
      'Clique em **Salvar**.',
    ],
    notes: [
      '"Informe pelo menos um fornecedor do terceirizado": escolha o fornecedor. Se ele não aparece, cadastre antes em Cadastros › Fornecedores.',
      '"Informe o custo do fornecedor": o custo precisa ser maior que zero.',
      '"O código X é do produto Y, que está inativo": o código já é de um produto inativo. Use outro código ou reative aquele produto.',
    ],
    permissions: [
      {
        action: 'create',
        resource: 'product_settings:products',
      },
      {
        action: 'edit',
        resource: 'product_settings:products',
      },
    ],
    requiredFeature: 'outsourced_item',
  },
  {
    id: 'clientes',
    title: 'Clientes',
    summary:
      'Cliente em **pré-cadastro** tem só o nome e já pode receber orçamento. Com os dados completos (nome ou razão social, CPF/CNPJ, telefone e endereço), ele fica **regularizado**.',
    keywords: [
      'cadastrar cliente',
      'pre-cadastro',
      'cliente regularizado',
      'buscar cnpj',
      'cliente duplicado',
      'inativar cliente',
      'grupo de clientes',
    ],
    paths: ['/cadastros/clientes'],
    steps: [
      'Abra **Cadastros › Clientes** e clique em **Novo cliente** (ou edite o cliente de exemplo).',
      'Digite o CPF ou CNPJ completo: o sistema busca os dados oficiais e preenche os campos vazios.',
      'Complete as abas **Informações gerais**, **Endereço** e **Responsáveis** e salve.',
      'Use os grupos de clientes para classificar (comércio, indústria, agências…) e filtrar relatórios.',
    ],
    notes: [
      '"Este CPF/CNPJ já está cadastrado como …": é só um aviso de possível duplicidade. Confira se é o mesmo cliente antes de salvar.',
      '"Documento inválido": confira os números do CPF/CNPJ. Para filial com o mesmo CNPJ, marque "Filial (Não validar CPF / CNPJ)".',
      'O cliente sumiu da lista: veja a aba Inativos ou Todos.',
      'Não consigo aprovar o orçamento de um cliente em pré-cadastro: o perfil do vendedor pode exigir cadastro regularizado. Complete o cadastro ou ajuste em Perfil de vendedor.',
    ],
    permissions: [
      {
        action: 'view',
        resource: 'register:client',
      },
    ],
  },
  {
    id: 'fornecedores',
    title: 'Fornecedores',
    summary:
      'Empresas e profissionais de quem a empresa compra ou contrata. São usados nas despesas, no terceirizado, na comissão de parceiros e no frete.',
    keywords: [
      'cadastrar fornecedor',
      'fornecedor generico',
      'dados de pagamento do fornecedor',
      'pix do fornecedor',
    ],
    paths: ['/cadastros/fornecedores'],
    steps: [
      'Abra **Cadastros › Fornecedores**. Edite os fornecedores de exemplo (Contabilidade, Água, Aluguel, Telefone) com os dados reais.',
      'Clique em **Novo fornecedor** para os demais. A busca por CPF/CNPJ funciona como em clientes.',
      'Em **Dados de pagamento**, registre chave Pix, banco, agência, conta e o prazo habitual.',
    ],
    notes: [
      'O parceiro que recebe comissão no orçamento precisa estar cadastrado como fornecedor.',
    ],
    permissions: [
      {
        action: 'view',
        resource: 'register:supplier',
      },
    ],
  },
  {
    id: 'importacoes',
    title: 'Importar planilhas',
    summary:
      'Clientes, fornecedores, produtos, orçamentos, ordens de serviço e receitas/despesas podem ser importados por planilha CSV, a partir do modelo do sistema.',
    keywords: [
      'importar clientes',
      'importar planilha',
      'importar produtos',
      'modelo de importacao',
      'erro na importacao',
      'csv',
    ],
    paths: ['/configuracoes/importacoes'],
    steps: [
      'Abra **Configurações › Importações** e escolha o que importar.',
      'Clique em **Baixar planilha modelo** e preencha sem mudar as colunas.',
      'Salve como **CSV** e envie (clique ou arraste o arquivo).',
      'Em **Revisar antes de importar**, confira o que será criado e confirme.',
    ],
    notes: [
      '"Por favor, selecione apenas arquivos CSV": salve a planilha como CSV antes de enviar.',
      '"Erros de importação": a tabela mostra a linha, a coluna, o valor e o motivo. Corrija na planilha e clique em Tentar novamente.',
    ],
    permissions: [
      {
        action: 'view',
        resource: 'import_settings:import',
      },
    ],
  },
  {
    id: 'series_de_venda',
    title: 'Séries de venda (treinamento e vendas reais)',
    summary:
      'A série define a validade da proposta e o prazo de entrega que entram em todo orçamento novo. O sistema vem com T1 – Treinamento (padrão), SL – Cortesia / Retrabalho e V1 – Vendas Diversas.',
    keywords: [
      'serie de venda',
      'validade do orcamento',
      'prazo de entrega padrao',
      'serie de treinamento',
      'apagar orcamentos de teste',
      'cortesia',
      'retrabalho',
    ],
    paths: ['/configuracoes/vendas'],
    steps: [
      'Abra **Configurações › Vendas › Séries de venda** e configure cada série: **Validade da proposta (dias)** e **Prazo de entrega**.',
      'Quando terminar os testes, marque **V1 – Vendas Diversas** como **série padrão**. Só uma série é padrão por vez.',
      'Para limpar os testes, use **Apagar todos os orçamentos, O.S. e movimentações** da série de treinamento.',
      'Use **SL – Cortesia / Retrabalho** para registrar trabalhos sem cobrança, como reimpressões.',
    ],
    notes: [
      'Os orçamentos reais estão saindo na série de treinamento: troque a série padrão para V1. Num orçamento já criado, a série pode ser trocada na edição (ele ganha uma nova numeração).',
      'Apagar os dados de teste não tem volta: confira antes de confirmar.',
    ],
    permissions: [
      {
        action: 'view',
        resource: 'sales_settings:series',
      },
    ],
  },
  {
    id: 'perfil_de_vendedor',
    title: 'Perfil de vendedor',
    summary:
      'O perfil reúne os vendedores com a mesma comissão, o mesmo desconto máximo, o valor mínimo de venda e o que eles podem aprovar ou cancelar.',
    keywords: [
      'comissao do vendedor',
      'desconto maximo',
      'valor minimo do pedido',
      'vendedor nao aparece no orcamento',
      'vendedor pode cancelar',
      'aprovar pre-cadastro',
    ],
    paths: ['/configuracoes/vendas/perfil-de-vendedor'],
    steps: [
      'Abra **Configurações › Vendas › Perfil de vendedor**.',
      'Crie um perfil (ou edite) com nome, **Comissão** (%), **Desconto máximo** (%) e **Valor mínimo**.',
      'Defina se o perfil pode **aprovar pré-cadastro** e **cancelar vendas**.',
      'Adicione os colaboradores que vendem ao perfil.',
    ],
    notes: [
      'O vendedor não aparece no campo Vendedor do orçamento: ele não está em nenhum perfil de vendedor.',
      'O orçamento não conclui por desconto ou valor mínimo: o perfil do vendedor limita o desconto e o valor mínimo da venda.',
    ],
    permissions: [
      {
        action: 'view',
        resource: 'sales_settings:seller_profile',
      },
    ],
  },
  {
    id: 'orcamento_criar',
    title: 'Criar um orçamento e adicionar itens',
    summary:
      'O orçamento nasce em **Digitação**. Nele se escolhe o cliente, adicionam-se os itens por setor e se definem entrega e pagamento.',
    keywords: [
      'como fazer orcamento',
      'novo orcamento',
      'adicionar item',
      'adicionar produto no orcamento',
      'produto nao aparece no orcamento',
      'editar item',
      'desconto no item',
      'duplicar item',
    ],
    paths: ['/vendas/orcamentos'],
    steps: [
      'Abra **Vendas › Orçamentos** e clique em **Novo orçamento**.',
      'Escolha o **Cliente** (busca por nome, CNPJ ou razão social; dá para fazer um pré-cadastro na hora), escreva a **Descrição do serviço** (ex.: "Placa Promoção de Verão"), confira a **Série**, o **Atendimento** e o **Vendedor**, e clique em **Cadastrar orçamento**.',
      'Clique em **Adicionar item**, escolha o setor e depois o produto. Use a busca por nome ou código.',
      'Informe a quantidade e as medidas, ajuste o **Descritivo técnico** se precisar e confirme ("Item adicionado").',
      'Pelo menu do item: Observações, Imagem, Duplicar, Editar, Valores (preço e desconto) e Excluir.',
    ],
    notes: [
      '"Nada encontrado" ao buscar o produto: tente outro nome ou outro setor. O produto pode estar inativo.',
      'Não consigo mudar o preço do item: o produto não permite editar valor, ou o cargo não tem a permissão de ver valores.',
      '"Um item tem produto inativado": troque ou retire o item. O orçamento não é aprovado com produto inativo.',
      'Só dá para mexer nos itens com o orçamento em Digitação. Concluído, clique em Editar para reabrir.',
    ],
    permissions: [
      {
        action: 'view',
        resource: 'sale:quotation',
      },
    ],
  },
  {
    id: 'orcamento_terceirizado',
    title: 'Terceirizado avulso no orçamento',
    summary:
      'Para um serviço contratado de fornecedor só para esta venda (instalação, por exemplo). Ao aprovar o orçamento, a conta a pagar ao fornecedor é gerada com o custo informado. O custo não aparece para o cliente.',
    keywords: [
      'terceirizado no orcamento',
      'servico de fornecedor',
      'instalacao terceirizada',
      'editar terceirizado',
      'custo do terceirizado',
    ],
    paths: ['/vendas/orcamentos'],
    steps: [
      'No orçamento em Digitação, clique em **Adicionar item** e no botão **Terceirizado**.',
      'Informe o **Serviço**, o **Fornecedor**, a **Quantidade** e o **Custo unitário**.',
      'Confira o **Preço de venda unitário**: o sistema sugere um preço pelo acréscimo configurado pela empresa, e quem vê valores pode alterar.',
      'Clique em **Lançar no orçamento**. O item aparece com o selo Terceirizado.',
      'Para alterar, clique no lápis do item, ajuste e clique em **Salvar**.',
    ],
    notes: [
      '"Informe o custo do terceirizado": o custo precisa ser maior que zero.',
      'Ao editar, o custo vem vazio: o seu cargo não vê valores. Digite o custo de novo.',
      'O fornecedor não aparece: cadastre em Cadastros › Fornecedores.',
    ],
    permissions: [
      {
        action: 'edit',
        resource: 'sale:quotation',
      },
    ],
    requiredFeature: 'outsourced_item',
  },
  {
    id: 'orcamento_entrega_pagamento',
    title: 'Entrega, condição de pagamento e comissão de parceiro',
    summary:
      'No orçamento se define como o trabalho chega ao cliente e como ele paga: nota, forma, parcelas, entrada, desconto e comissão de parceiros externos.',
    keywords: [
      'condicao de pagamento',
      'parcelar orcamento',
      'entrada no orcamento',
      'frete',
      'entrega',
      'comissao do arquiteto',
      'comissao de parceiro',
      'desconto no total',
    ],
    paths: ['/vendas/orcamentos'],
    steps: [
      'Em **Editar entrega**, escolha o tipo (cliente retira, entrega/instalação ou transportadora), o prazo em dias após a aprovação, o endereço, e o custo e o valor do frete se houver. O custo do frete vira despesa no fluxo financeiro ao aprovar.',
      'Em **Editar condições de pagamento**, escolha a nota (NF-e, NFS-e ou A definir), a forma de pagamento, as parcelas, a entrada e o desconto.',
      'Para comissão de arquiteto, agência ou representante, adicione a comissão escolhendo o parceiro (cadastrado como fornecedor), se ela soma ao preço ou sai do valor, e o repasse (parcela única ou junto com as parcelas do cliente).',
    ],
    notes: [
      '"A entrada não pode consumir todo o valor total": diminua a entrada ou use pagamento à vista.',
      '"O valor inserido ultrapassa o total disponível": a última parcela ficaria negativa. Ajuste os valores das parcelas.',
      '"Informe a forma de pagamento da entrada para continuar": escolha a forma da entrada.',
      'As parcelas que aparecem dependem da forma de pagamento configurada em Configurações › Financeiro › Configurações de pagamento.',
    ],
    permissions: [
      {
        action: 'view',
        resource: 'sale:quotation',
      },
    ],
  },
  {
    id: 'orcamento_concluir_imprimir',
    title: 'Concluir, imprimir e enviar a proposta',
    summary:
      'Em Digitação, a impressão sai com a marca "PRÉVIA". Ao concluir, o orçamento vai para **Aguardando** e a proposta sai limpa, pronta para o cliente.',
    keywords: [
      'concluir orcamento',
      'imprimir orcamento',
      'proposta em pdf',
      'marca previa',
      'enviar orcamento',
      'esconder valor unitario',
      'orcamento nao conclui',
    ],
    paths: ['/vendas/orcamentos'],
    steps: [
      'Revise pelo botão **Prévia da proposta**.',
      'Clique em **Concluir orçamento**. Se aparecer "Concluir mesmo assim?", leia os avisos e decida.',
      'Com "Orçamento concluído", clique em **Imprimir** (ou depois no botão **Proposta**).',
      'Em **Opções de impressão**, escolha o que mostrar: imagens, medidas, valor unitário, valor final do item, totais, pagamento e entrega, assinatura.',
      'O PDF abre em outra aba, com **Baixar PDF**. Envie o arquivo ao cliente pelo seu e-mail ou WhatsApp.',
    ],
    notes: [
      'A proposta sai com "PRÉVIA": o orçamento ainda está em Digitação. Conclua para sair sem a marca.',
      '"Sem condição de pagamento": dá para concluir, mas a aprovação vai pedir as parcelas.',
      '"Orçamento não passou pelo checkout": leia o motivo na mensagem (desconto acima do permitido, valor mínimo do vendedor, cadastro do cliente) e corrija.',
      'O PDF não abriu: o navegador bloqueou a janela. Libere pop-ups para o Atrupe.',
      'Para mudar algo depois de concluído, clique em **Editar**: o orçamento volta para Digitação.',
    ],
    permissions: [
      {
        action: 'view',
        resource: 'sale:quotation',
      },
    ],
  },
  {
    id: 'orcamento_aprovar_rejeitar',
    title: 'Aprovar, rejeitar, reabrir e duplicar',
    summary:
      'Aprovado, o orçamento vira **ordem de serviço** e os valores entram no fluxo financeiro. Rejeitado, ele fica guardado e pode ser reaberto.',
    keywords: [
      'aprovar orcamento',
      'nao consigo aprovar',
      'rejeitar orcamento',
      'rejeitei sem querer',
      'reabrir orcamento',
      'duplicar orcamento',
      'orcamento vencido',
    ],
    paths: ['/vendas/orcamentos'],
    steps: [
      'Com o orçamento em Aguardando (ou Vencido), clique em **Aprovar orçamento** e confirme. O sistema abre a ordem de serviço.',
      'Se o cliente recusar, clique em **Rejeitar orçamento**.',
      'Para voltar um orçamento rejeitado, aguardando ou vencido para Digitação, clique em **Reabrir orçamento**.',
      'Para um orçamento parecido, use **Duplicar**: troque o cliente se quiser e escolha manter os valores originais ou usar os valores atuais dos produtos.',
    ],
    notes: [
      '"Informe a condição de pagamento para aprovar": clique em Informar condição de pagamento, preencha e continue.',
      '"Este orçamento não pode ser aprovado" por produto inativado: troque ou retire o item indicado.',
      'Não consigo aprovar para cliente em pré-cadastro: complete o cadastro do cliente ou peça para ajustar o perfil do vendedor.',
      'Rejeitar no Start é imediato, sem confirmação. Se foi por engano, use **Reabrir orçamento**.',
      'O orçamento foi para Vencidos: passou da validade da série. Ainda dá para aprovar ou reabrir.',
    ],
    permissions: [
      {
        action: 'view',
        resource: 'sale:quotation',
      },
    ],
  },
  {
    id: 'acompanhamento_comercial',
    title: 'Acompanhamento comercial (a partir do Lite)',
    summary:
      'Registrar os contatos com o cliente, marcar o próximo contato e ver na aba Aguardando o que está parado. Faz parte do plano Lite em diante; no Start, a aba Aguardando é só a lista dos orçamentos concluídos.',
    keywords: [
      'acompanhar orcamento',
      'registrar contato',
      'proximo contato',
      'para retomar',
      'chamar cliente no whatsapp',
      'modelo de mensagem',
      'clientes sem compra',
      'lembrete por e-mail',
    ],
    paths: ['/vendas/orcamentos'],
    steps: [
      'Na aba **Aguardando**, use os focos **Para retomar**, **Sem contato** e **Vencendo** para ver o que precisa de ação hoje.',
      'Na linha do orçamento ou no cartão **Acompanhamento**, clique em **Registrar contato**: informe o que aconteceu e quando volta a falar.',
      '**Chamar no WhatsApp** abre a conversa com a mensagem do modelo da empresa.',
      'Em **Configurações › Vendas › Acompanhamento comercial**, ajuste os modelos de mensagem, o lembrete por e-mail e os dias para o cliente contar como sem compra.',
    ],
    notes: [
      '"Chamar no WhatsApp" desabilitado: falta o celular no cadastro do cliente.',
      'Não vejo os focos nem o cartão Acompanhamento: a empresa está no Start. O acompanhamento comercial é do Lite em diante.',
    ],
    permissions: [
      {
        action: 'view',
        resource: 'sale:quotation',
      },
    ],
    requiredFeature: 'sales_follow_up',
  },
  {
    id: 'ordens_de_servico',
    title: 'Ordens de serviço',
    summary:
      'A ordem de serviço é o orçamento aprovado. Dela saem a via do cliente, a ficha de produção (sem valores) e o histórico.',
    keywords: [
      'ordem de servico',
      'ficha de producao',
      'via do cliente',
      'cancelar venda',
      'cancelar ordem de servico',
      'editar ordem de servico',
      'trocar cliente da os',
    ],
    paths: ['/vendas/ordens-de-servico'],
    steps: [
      'Abra **Vendas › Ordens de serviço**. As abas são Aprovadas, Canceladas e Todas.',
      'Na linha: **Visualizar venda**, **Via do cliente**, **Ficha de produção**, **Duplicar orçamento** e **Histórico**.',
      'Para trocar cliente, vendedor, responsável, série ou endereço de entrega, abra a ordem e use **Editar informações**.',
      'Para cancelar, abra a ordem e clique em **Cancelar venda**. As parcelas em aberto são canceladas junto.',
    ],
    notes: [
      '"Parcelas não canceladas": algumas parcelas já foram pagas ou recebidas. Desfaça a baixa dessas parcelas no Fluxo financeiro, se for o caso.',
      'Para mudar itens ou valores de uma venda aprovada, cancele e refaça a partir de um orçamento duplicado. Na dúvida, fale com o suporte.',
      'A ordem ficou sem as parcelas ou a agenda de entrega: use **Reprocessar aprovação** na ordem. Se continuar, fale com o suporte.',
    ],
    permissions: [
      {
        action: 'view',
        resource: 'sale:order',
      },
    ],
  },
  {
    id: 'agenda_de_entrega',
    title: 'Agenda de entrega',
    summary:
      'Mostra os serviços aprovados por data de entrega. Nela se marca a data, finaliza o serviço e fatura.',
    keywords: [
      'agenda de entrega',
      'finalizar servico',
      'faturar servico',
      'mudar data de entrega',
      'entregas do dia',
    ],
    paths: ['/producao/agenda-de-entrega'],
    steps: [
      'Abra **Produção › Agenda de entrega**. As abas são Entrega, Faturamento e Finalizados.',
      'Para mudar a data ou o horário, use **Data** na linha do serviço.',
      'Quando o trabalho estiver pronto, clique em **Finalizar serviço**.',
      'Na aba Faturamento, clique em **Faturar** para gerar a cobrança. Depois, o botão vira **Editar parcelas**.',
    ],
    notes: [
      '"Horário inválido": use o formato HH:mm, com horas de 0 a 23.',
      '"Este cliente está bloqueado no cadastro: não gera cobrança": o cadastro do cliente está bloqueado. Fale com o administrador.',
      'O botão de nota fiscal da agenda ainda não está disponível: emita pela área de Nota fiscal, se o módulo estiver contratado.',
    ],
    permissions: [
      {
        action: 'view',
        resource: 'production:delivery_schedule',
      },
    ],
  },
  {
    id: 'financeiro_contas_e_pagamentos',
    title: 'Caixa Empresa e formas de pagamento',
    summary:
      'No Start, o dinheiro fica num único ponto de controle, o **Caixa Empresa**. As formas de pagamento definem o que a empresa aceita receber e pagar, e se aceitam parcelamento.',
    keywords: [
      'conta bancaria',
      'criar banco',
      'forma de pagamento',
      'parcelamento no cartao',
      'aceita recebimento',
      'nova condicao de pagamento',
      'antecipar parcelas',
    ],
    paths: ['/configuracoes/financeiro'],
    steps: [
      'Abra **Configurações › Financeiro › Contas bancárias** e edite o Caixa Empresa: marque, em cada forma, se ela **aceita recebimento** e se **aceita pagamento**.',
      'Em **Configurações de pagamento**, edite cada forma (boleto, cartão, dinheiro, Pix): se aceita parcelamento e em quantas vezes, se recebe parcelado ou antecipado, e o intervalo em dias.',
      'Se faltar uma forma (cheque, permuta, link de pagamento…), crie em **Nova condição de pagamento**.',
    ],
    notes: [
      'Não há botão para criar outra conta bancária: no Start o financeiro trabalha só com o Caixa Empresa.',
      'A forma de pagamento não aparece no orçamento ou na baixa: ela não está marcada como aceita no Caixa Empresa.',
    ],
    permissions: [
      {
        action: 'view',
        resource: 'financial_settings:bank_accounts',
      },
      {
        action: 'view',
        resource: 'financial_settings:payment_methods',
      },
    ],
  },
  {
    id: 'plano_de_contas',
    title: 'Plano de contas',
    summary:
      'Classifica cada entrada e saída de dinheiro. O sistema vem com um plano pronto para comunicação visual e gráficas, que pode ser editado.',
    keywords: [
      'plano de contas',
      'categoria de despesa',
      'criar categoria',
      'subcategoria',
      'inativar categoria',
    ],
    paths: ['/configuracoes/financeiro/plano-de-contas'],
    steps: [
      'Abra **Configurações › Financeiro › Plano de contas**.',
      'O primeiro nível separa **Receitas** e **Despesas**; o segundo, **Administrativo**, **Operacional** e **Não operacional**.',
      'Para incluir um tipo novo, use **Adicionar subcategoria** numa categoria existente. Crie **Nova categoria** só quando nenhuma servir.',
      'O **Código final** é montado pelo sistema a partir dos níveis.',
    ],
    notes: [
      'Categoria que não serve mais: inative. Ela sai dos novos lançamentos e o histórico fica guardado.',
    ],
    permissions: [
      {
        action: 'view',
        resource: 'financial_settings:chart_accounts',
      },
    ],
  },
  {
    id: 'fluxo_financeiro',
    title: 'Fluxo financeiro: lançar, dar baixa e cancelar',
    summary:
      'Lista todas as receitas e despesas do período, por dia. É onde se lança, dá baixa, edita parcelas e cancela movimentações.',
    keywords: [
      'lancar despesa',
      'lancar receita',
      'dar baixa',
      'marcar como pago',
      'desfazer pagamento',
      'cancelar lancamento',
      'editar parcelas',
      'imprimir recibo',
      'exportar financeiro',
      'saldo do mes',
      'mostrar totais',
    ],
    paths: ['/financeiro/fluxo-financeiro'],
    steps: [
      'Abra **Financeiro › Fluxo financeiro**. Use os filtros **Período**, **Status** e **Forma de pagamento**, e o ícone de olho para **Mostrar totais**.',
      'Para lançar, clique em **Nova receita** ou **Nova despesa**: informe o valor, o cliente ou fornecedor, a descrição, a categoria, a forma de pagamento, as parcelas e o vencimento, e salve. Com uma parcela só, dá para já marcar como pago.',
      'Para dar baixa, clique no ícone de status da parcela, confira data, forma e valor e clique em **Confirmar recebimento** ou **Confirmar pagamento**.',
      'Para desfazer uma baixa, clique no ícone da parcela realizada e em **Desfazer pagamento/recebimento**.',
      'Para cancelar, abra os detalhes e clique em **Cancelar movimentação**. Só as parcelas não realizadas são canceladas.',
      'Para recibos, marque as parcelas de um mesmo cliente e clique em **Imprimir recibo**.',
    ],
    notes: [
      '"Alterar valor?" na baixa: o valor pago é diferente da parcela. Confirme se quer mudar o valor da movimentação.',
      '"Esta movimentação não pode ser cancelada": todas as parcelas já foram pagas. Desfaça as baixas antes.',
      '"Ainda há saldo a repassar nas parcelas": a soma das parcelas não fecha com o total. Use Repassar saldo ou ajuste os valores.',
      '"Selecione parcelas do mesmo CPF/CNPJ": o recibo agrupado é de um cliente só.',
      'Não acho um lançamento: confira o Período e a troca entre **data de vencimento** e **data de pagamento** (ícone no topo).',
      'A descrição de uma receita que veio de orçamento não se edita no financeiro.',
      'Não vejo os filtros ou o menu Financeiro: falta permissão no cargo (ver valores e o fluxo financeiro).',
    ],
    permissions: [
      {
        action: 'view',
        resource: 'financial:flow',
      },
    ],
  },
  {
    id: 'despesas_fixas',
    title: 'Despesas fixas: cadastrar e lançar no mês',
    summary:
      'As despesas que se repetem todo mês (aluguel, internet, contador) são cadastradas uma vez e lançadas mês a mês como despesa no fluxo financeiro.',
    keywords: [
      'despesa fixa',
      'lancar aluguel',
      'despesas do mes',
      'lancar todas as despesas',
      'remover lancamento de despesa fixa',
    ],
    paths: ['/financeiro/despesas-fixas'],
    steps: [
      'Cadastre cada despesa em **Nova despesa fixa**: fornecedor, descrição, categoria e subcategoria, valor médio e dia do vencimento.',
      'Em **Financeiro › Despesas fixas**, escolha o mês com as setas ou em **Mês de referência**.',
      'Clique no **+** da despesa para lançar (ajuste competência, vencimento e valor) ou marque várias e clique em **Lançar selecionadas**.',
    ],
    notes: [
      '**Remover** apaga o lançamento do mês na hora, sem pedir confirmação. Não funciona para despesa já paga.',
      'A despesa já lançada não pode ser marcada de novo no mesmo mês.',
      'Antes de cadastrar, edite os fornecedores de exemplo (Aluguel, Água, Contador) com os dados reais.',
    ],
    permissions: [
      {
        action: 'view',
        resource: 'financial:fixed_expense',
      },
    ],
  },
  {
    id: 'folha_de_pagamento',
    title: 'Folha de pagamento',
    summary:
      'No Start, a folha registra o salário líquido de cada colaborador, com acréscimos, descontos e adiantamentos. Ao lançar, ela gera a despesa do salário.',
    keywords: [
      'folha de pagamento',
      'salario do funcionario',
      'adiantamento de salario',
      'vale',
      'fechar folha',
      'erro ao lancar folha',
      'comissao na folha',
    ],
    paths: ['/financeiro/folha-de-pagamento'],
    steps: [
      'Em **Configurações › Financeiro › Folha de pagamento**, informe o **salário líquido** de cada colaborador. Itens que variam (comissão, ajuda de custo) podem ficar com valor zero para preencher no mês.',
      'Em **Financeiro › Folha de pagamento**, escolha o mês e clique em **Lançar** (ou marque vários e **Lançar selecionadas**).',
      'Abra a folha pelo lápis para **Adicionar item** (acréscimo ou desconto) ou lançar um **Adiantamento de salário**.',
      'Quando estiver certa, clique em **Fechar folha**. Para mudar depois, **Reabrir folha**.',
    ],
    notes: [
      '"Erro ao lançar folha. Verifique se colaborador possui configurações de salário definidas": configure o salário do colaborador em Configurações › Financeiro › Folha de pagamento.',
      '"Já existe uma folha de pagamento lançada para o colaborador": a folha do mês já existe. Abra pelo lápis.',
      'Os botões da folha estão desabilitados: a folha está fechada. Reabra para editar.',
      'Excluir um item recalcula a despesa do salário. Cancelar um adiantamento pago também estorna o pagamento.',
    ],
    permissions: [
      {
        action: 'view',
        resource: 'financial:payroll',
      },
    ],
  },
  {
    id: 'relatorios',
    title: 'Relatórios',
    summary:
      'Vendas, produtos, financeiro, projeção de caixa, DFC, comissões e resultado por setor. Todos exportam em PDF ou Excel.',
    keywords: [
      'relatorio de vendas',
      'relatorio financeiro',
      'dfc',
      'projecao de caixa',
      'relatorio de comissao',
      'produtos mais vendidos',
      'clientes sem compra',
      'exportar relatorio',
      'resultado por setor',
    ],
    paths: ['/relatorios/vendas'],
    steps: [
      'Abra **Relatórios** e escolha o relatório.',
      'Ajuste os filtros (período, vendedor, cliente, série) e veja os cartões e gráficos.',
      '**Vendas** mostra aprovadas, aguardando, canceladas, ticket médio, origens, melhores clientes, produtos e clientes sem compra (com botão de WhatsApp).',
      '**Comissões**: escolha comissão pelo valor vendido ou pelo valor recebido.',
      '**DFC**: escolha o regime (Competência ou Realizado).',
      'Clique em **Exportar** para PDF ou Excel. Em Vendas e Financeiro há também o **Relatório avançado**.',
    ],
    notes: [
      '"Você não tem permissão para acessar os relatórios": o cargo precisa da permissão de ver valores e do relatório.',
      'No celular, a barra de filtros fica escondida; use o computador para filtrar (em Vendas e Produtos há o botão de filtro).',
      'O vendedor só vê as próprias vendas e comissões, a não ser que o cargo permita ver os outros vendedores.',
      '"Sem dados no período selecionado": amplie o período.',
    ],
    permissions: [
      {
        action: 'view',
        resource: 'reports:sales',
      },
      {
        action: 'view',
        resource: 'reports:financial',
      },
      {
        action: 'view',
        resource: 'reports:dfc',
      },
      {
        action: 'view',
        resource: 'reports:commission',
      },
      {
        action: 'view',
        resource: 'reports:sector_result',
      },
    ],
  },
  {
    id: 'nota_fiscal_modulo',
    title: 'Nota fiscal no Start',
    summary:
      'A emissão de NF-e, NFS-e e NFC-e é um módulo contratado à parte. Com o módulo, o menu Nota fiscal aparece e os produtos ganham a aba de dados fiscais.',
    keywords: [
      'emitir nota fiscal',
      'nota fiscal no start',
      'nao aparece nota fiscal',
      'contratar nota fiscal',
    ],
    paths: ['/nota-fiscal/emitir'],
    steps: [
      'Sem o módulo, o campo **Nota** do orçamento serve só como indicação (NF-e, NFS-e ou A definir) para quem emite a nota fora do sistema.',
      'Para contratar o módulo, fale com o time comercial. Com ele ativo, a configuração fica em **Configurações › Nota fiscal**.',
    ],
    notes: [
      'Nota recusada, certificado digital ou configuração fiscal: passe para o suporte humano.',
    ],
  },
  {
    id: 'assistente_ia',
    title: 'Assistente IA dentro do sistema',
    summary:
      'Responde dúvidas de uso e consulta os dados da empresa (vendas, financeiro, cadastros), respeitando as permissões do usuário. O assistente ainda está em construção: novas funções entram aos poucos.',
    keywords: [
      'assistente ia',
      'inteligencia artificial',
      'robo',
      'chat do sistema',
    ],
    paths: [],
    steps: [
      'Clique no botão do robô no canto inferior direito e escreva a pergunta em **Digite sua pergunta**.',
      'Use **Nova conversa** para mudar de assunto e **Excluir conversa** para apagar o histórico.',
    ],
    notes: [
      'O botão não aparece: o assistente está desligado no momento. Fale com o suporte.',
      'O assistente não mostra um dado: o seu cargo não tem permissão para aquela informação.',
      'O assistente não faz uma ação (criar orçamento, lançar, dar baixa): ele orienta onde fazer. Nada é gravado pelo chat.',
    ],
  },
];
