# Publicação e monetização

Consulta às fontes oficiais em 13 de outubro de 2026. Estas notas não substituem autorização das plataformas nem aconselhamento jurídico.

## Hardcover

A integração não precisa ser gratuita. A seção Commercial API Use permite que produtos comerciais acessem dados pessoais em nome de um usuário que autorizou esse acesso. Não permite reutilizar livremente bibliotecas, avaliações e outros dados de terceiros.

Para distribuição, a documentação atual recomenda OAuth e orienta não pedir que usuários colem Personal Access Tokens no aplicativo. O token manual desta versão é apenas para desenvolvimento e uso pessoal pelo proprietário da conta. Antes de publicar, implementar consentimento, revogação e renovação segura com OAuth. O fluxo Device Authorization Grant pode ser adequado para o relógio, mas exige cadastro do aplicativo no Hardcover e validação no serviço da Zepp.

As capas não recebem uma licença comercial irrestrita por estarem na API. A documentação alerta sobre direitos autorais e exige uma política de remoção DMCA quando imagens são disponibilizadas publicamente. Conferir as obrigações aplicáveis antes de usar capas reais em páginas promocionais ou screenshots de loja.

Usar apresentação de integração não oficial, sem afirmar aprovação ou parceria. Conferir separadamente o uso da marca e de logotipos; as permissões de API não resolvem direitos de marca.

Fonte: https://docs.hardcover.app/api/getting-started/
OAuth: https://docs.hardcover.app/api/oauth/

## Zepp

A documentação consultada restringe o canal oficial de aplicativos pagos a desenvolvedores empresariais certificados da China continental. Isso impede assumir que uma conta individual de outro país possa definir um preço de download na loja.

Para miniapps, a Zepp permite soluções razoáveis de compras dentro do aplicativo, incluindo Kiezelpay ou esquemas por QR code. A forma de pagamento precisa ser explicada na submissão e continua sujeita à aprovação. Isso é diferente de uma compra paga diretamente para baixar o aplicativo na loja.

Não foi integrado nenhum sistema de pagamento neste projeto. Confirmar elegibilidade, termos, taxas, suporte ao iPhone e regras vigentes com a Zepp antes de implementar cobrança.

Fonte: https://docs.zepp.com/docs/guides/faq/paid-app/
Submissão: https://docs.zepp.com/docs/distribute/

## Antes de publicar

- Registrar appId próprio na Zepp e aplicativo OAuth no Hardcover.
- Implementar OAuth com permissões mínimas e sem segredo de cliente embutido.
- Testar no Bip 6 real com Zepp no iPhone, inclusive conexão em segundo plano e chegada de capas.
- Escrever política de privacidade fiel aos dados armazenados e destinos de rede.
- Validar exclusão dos dados locais ao desconectar a conta.
- Conferir marca, materiais promocionais e direitos das capas.
- Se houver cobrança, validar o fluxo e declará-lo à Zepp.
