# Validação no Bip 6 e iPhone

Esta lista é um roteiro para o dispositivo. Não marcar itens sem observar o comportamento no aparelho.

## Validação de API executada

Em 13 de outubro de 2026, foram executadas consultas somente de leitura com uma conta real: autenticação, as três seções da biblioteca, paginação, adaptação da resposta para o relógio e download HTTPS de uma capa. O download da imagem não recebeu a credencial da API. Nenhuma mutação foi enviada. A credencial não foi salva nos arquivos do projeto.

Isso não valida conversão de imagem pela Zepp, transferência Bluetooth, interface no simulador ou funcionamento no iPhone e relógio reais. Os testes automatizados de atualização de progresso continuam usando respostas simuladas.

## Preparação

- Atualizar o Zepp no iPhone e o firmware do Bip 6.
- Anotar as versões do iOS, Zepp, firmware e API_LEVEL mostrado no modo desenvolvedor.
- Registrar o miniapp no console da Zepp e usar seu appId antes da publicação.
- Habilitar o modo desenvolvedor no Zepp, gerar o QR de preview e instalar pelo scanner do Zepp.
- Criar uma chave pessoal exclusiva com permissões mínimas. Não usar chave de acesso total nem compartilhar logs contendo Authorization.
- Anotar o progresso de um livro de teste antes de alterar dados reais.

## Biblioteca

- Confirmar que os livros pertencem à conta conectada.
- Confirmar nomes e ordem: Currently Reading, Want to Read, Read.
- Confirmar que o primeiro livro em leitura tem capa em destaque.
- Testar mais de um livro em leitura e listas vazias.
- Testar paginação com uma conta que tenha mais livros que o tamanho de página configurado.
- Verificar títulos longos, autores ausentes e capas ausentes.

### Revisão de interface compacta

Feedback recebido no primeiro teste real: a barra do sistema cobre as abas, as setas ocupam espaço desnecessário e o teclado numérico é difícil de tocar. A revisão em andamento deve substituir abas e setas por navegação horizontal e o teclado por seletor nativo. Validar no dispositivo:

### Segunda rodada de feedback

A versão 0.2.0 apresentou uma falha real de confirmação do seletor e uma barra do sistema sobreposta à watchface ao sair. Testes que chamam diretamente callbacks não demonstram que o botão recebe um toque no relógio. A próxima versão precisa validar os controles pela interação real.

Nova organização solicitada: Currently Reading com capas na tela inicial e navegação vertical entre leituras; Want to Read e Read em telas laterais com listas sem capas. O indicador da tela inicial passa a contar apenas os livros em leitura. Read pode mostrar a avaliação do usuário, quando houver. O botão Refresh deve sair da tela principal; a atualização ocorre na abertura. Carregamento deve mostrar apenas Loading, com apresentação visual própria.

- Confirmar o valor escolhido por rolagem no relógio e verificar que a tela de revisão mostra exatamente o valor escolhido.
- Cancelar a seleção não deve enviar uma atualização.
- Abrir, sair para a watchface e repetir pelo menos três vezes. Nenhuma barra do app deve permanecer na watchface.
- Verificar centralização do indicador na parte inferior.
- Testar navegação vertical com mais de um livro em leitura e conferir correspondência entre livro e capa.
- Verificar que navegar nas listas laterais não baixa capas.
- Conferir notas com e sem avaliação, inclusive valores fracionários.
- Reabrir o app deve atualizar os dados, sem repetir o download de capas válidas.
- Confirmar ausência do botão Refresh em uso normal e de mensagens Loading from phone.

Os critérios de navegação horizontal da rodada anterior abaixo são históricos; a nova organização acima os substitui.

- A barra de título/horário não cobre controles.
- Deslizar passa pelos livros em ordem Currently Reading, Want to Read e Read, sem atualizar progresso por acidente.
- O indicador atual/total representa a coleção completa, não apenas o lote carregado.
- Navegação continua correta ao atravessar lotes e seções vazias.
- Gestos no seletor numérico não mudam o livro por trás dele.
- Cancelar o seletor não salva o progresso; confirmar ainda exige uma ação explícita de envio.
- Página e porcentagem podem ser selecionadas com precisão sem botões pequenos.
- Todos os controles usam texto ou recursos gráficos suportados, sem depender do glifo de apagar.

## Terceira rodada, versão 0.4.0

Os itens abaixo substituem a exigência anterior de uma tela de revisão.

- Update envia diretamente o valor escolhido. Cancel não envia nada.
- Saved desaparece após aproximadamente dois segundos sem cobrir a porcentagem.
- Os títulos usam o mesmo tamanho e centralização, sem cortes nas bordas.
- Update progress e Load more ocupam todo o rodapé com a mesma altura. Cancel e Update dividem essa faixa no seletor.
- Os atalhos de página ajustam em 10 e 100; os de porcentagem em 5 e 10 pontos percentuais, respeitando os limites.
- Reabrir com cache válido mostra os livros sem Loading em tela cheia. A atualização acontece em segundo plano.
- Enviar progresso confirmado, fechar e reabrir conserva o novo valor mesmo antes da sincronização.
- Desligar a conexão mantém a biblioteca salva disponível. Trocar a chave com conexão invalida os dados da conta anterior.
- Verificar que a tela permanece acesa por até dois minutos de inatividade. A API é restrita à página e não altera o comportamento global de pulso ou palma.
- Sair do app e verificar que outros apps e a watchface continuam com seu comportamento normal de tela.

## Capas

- Confirmar download e conversão no serviço do iPhone.
- Confirmar transferência Bluetooth e exibição pelo caminho local no relógio.
- Trocar rapidamente de livro durante a transferência e verificar que a capa anterior não aparece no novo livro.
- Testar falha de rede, URL expirada e imagem não suportada. A navegação e o texto precisam continuar disponíveis.
- Conferir proporção, legibilidade e memória com diversas capas.
- Fechar e abrir o miniapp mantém a capa local e evita novo download quando a imagem não mudou.
- Capa removida ou cache incompleto é baixado novamente sem ficar preso em estado de carregamento.
- Troca de imagem ou conta invalida o cache correspondente.
- Navegar por muitos livros mantém o cache limitado e remove arquivos sem uso.

## Progresso

Usar um livro de teste. Verificar no Hardcover após cada envio e restaurar os dados ao final.

- Página atual é um valor absoluto, não um incremento por sessão.
- Enviar uma página válida e conferir a edição e o registro de leitura alterados.
- Alternar para porcentagem e enviar um valor intermediário.
- Testar 0% e 100%; conferir se o aplicativo altera apenas progresso ou também status. Não assumir conclusão automática.
- Rejeitar números negativos, entrada vazia, porcentagem acima de 100 e páginas inválidas.
- Testar livro sem total de páginas. Não fabricar equivalência entre página e porcentagem.
- Atualizar externamente antes de salvar no relógio e conferir o comportamento.
- Testar ausência de registro ativo. Não criar uma releitura inesperada.
- Falha ou timeout de envio não pode ser exibido como sucesso.
- Evitar repetir uma mutação automaticamente depois de timeout, pois o servidor pode já ter aplicado a primeira.

## iPhone e credenciais

- Conferir envio com Zepp aberto, em segundo plano e iPhone bloqueado. Registrar diferenças.
- Desconectar Bluetooth e conferir mensagem de erro e dados disponíveis localmente.
- Revogar a chave no Hardcover e verificar que não aparece sucesso de sincronização.
- Trocar de conta e confirmar ausência de dados ou capas pessoais da conta anterior.
- Não divulgar logs, prints de configurações ou pacote com credenciais.

## Critério de entrega

Compilação e testes mockados aprovados não significam integração real validada. A entrega para loja exige testes de dispositivo, OAuth, política de privacidade e revisão das exigências de publicação descritas em [publishing.md](publishing.md).
