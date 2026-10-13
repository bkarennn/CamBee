# Cantar com a letra

Na branch `marcelomurilo`, cole a letra em **Mostrar letra**, escolha o idioma e clique em **Começar a cantar**. Permita o microfone. Abra o CamBee por HTTPS ou localhost (por exemplo, `python -m http.server 8765 --bind 127.0.0.1`).

O modo **Navegador** usa SpeechRecognition, quando disponível, sem instalar um backend. Ele usa o microfone padrão do navegador, pode depender de internet e envia o áudio ao serviço escolhido pelo navegador. Resultados provisórios aparecem em “Ouvi” e já acionam o brilho e o acompanhamento da letra, sem esperar a confirmação da frase. Se o navegador corrigir uma palavra, a posição provisória pode ser corrigida também. Resultados finais consolidam a posição inferida. Canto prolongado, ruído e música de fundo podem reduzir a precisão. Use fones.

As palavras até a posição inferida ficam douradas e recebem uma pequena estrela durante 650 ms. O efeito respeita a preferência de movimento reduzido. A opção **Acompanhar a letra com minha voz** mantém a linha cantada visível. Tudo é desenhado no canvas e, portanto, faz parte da gravação existente. Parar preserva a posição consolidada; voltar ao início, editar a letra ou reiniciar o estúdio encerra o reconhecimento e limpa o progresso.

O objetivo é acompanhar a posição na música, sem pontuar a precisão das palavras. Ao colar ou editar a letra, o CamBee prepara uma estrutura própria para esse texto: palavras originais e normalizadas, posições no texto, linhas e um índice de todas as ocorrências de cada palavra. A segmentação usa `Intl.Segmenter` quando disponível, com alternativa Unicode para navegadores sem esse recurso. O texto da caixa permanece intacto. Abaixo dela aparece a quantidade de palavras e linhas preparadas.

Durante o canto, os últimos 18 tokens da transcrição consultam esse índice. Comparações aproximadas são calculadas uma vez por palavra ouvida e reutilizadas em cache limitado. O alinhamento examina janelas candidatas com maior apoio nas palavras ouvidas, além da região atual, em vez de varrer toda a letra a cada evento. Resultados parciais idênticos também reutilizam a comparação anterior. Editar a letra descarta o índice, as comparações e a posição antigos.

A lógica tolera diferenças de escrita, terminações cortadas, palavras extras e palavras omitidas. Usa semelhança textual e contexto em sequência, sem vocabulário especial para uma música nem um modelo de IA adicional. Por exemplo, “All my dad Cry” ou “dad cry” podem localizar “My daddy cry”: todas as palavras anteriores até “cry” entram no progresso, mesmo sem terem sido reconhecidas individualmente. Esse exemplo é um caso de teste, não uma substituição cadastrada no mecanismo.

Uma palavra semelhante pode continuar a posição atual; saltos para outros trechos exigem uma frase com evidência suficiente. Em refrões repetidos, a proximidade da posição atual favorece a ocorrência mais próxima. O índice cobre toda a letra, sem o antigo limite de oito palavras, mas limita as ocorrências e janelas examinadas para manter a resposta rápida. Uma ocorrência distante pode não ser escolhida quando há muitas repetições ambíguas. A interface mostra **Progresso da letra**, sem contagem de acertos. Essa inferência pode se enganar com trechos muito parecidos e não avalia afinação nem elimina a latência do serviço de transcrição.

## Servidor Just Sing

Referência pesquisada e clonada em `.references/Just-Sing`: https://github.com/alexandre-carmone/Just-Sing.

Commit consultado: `08e2f17089439a91b0a31082c3b17ce165476a76`.

O adaptador independente em `lyrics-sing.js` implementa o protocolo observado em `front/src/hooks/useAudioStreaming.js` e `back_sing/app.py`: áudio mono Float32 a 24 kHz em blocos de 2048 amostras; respostas JSON com `word` e `timestamp`. O matching com a letra colada e o efeito no canvas são implementações próprias do CamBee. O clone fica ignorado pelo Git; não é necessário distribuir o frontend React nem copiar o código do projeto de referência.

Para usar o backend original, instale Python compatível com o projeto (requer >=3.12; TensorFlow e CREPE têm suas próprias restrições) e `uv`. No PowerShell:

```powershell
cd .references/Just-Sing/back_sing
uv sync
$env:GRADIUM_KEY = 'sua-chave'
uv run bentoml serve app.py -p 3000 --host 127.0.0.1
```

No CamBee, selecione **Just Sing (servidor)** e use `ws://localhost:3000/sing/ws/transcription`. Para uma página HTTPS, use um endpoint `wss://`. O idioma nesse modo é responsabilidade do backend/provedor. O áudio usa o microfone selecionado no estúdio, em uma captura independente, e é encaminhado pelo backend à Gradium. Mantenha a chave somente no ambiente do servidor.

O backend original carrega também modelos de afinação mesmo quando só o endpoint de transcrição é usado. Esta integração não exige os endpoints de pitch nem a letra de demonstração temporizada do Just Sing.

O teste de reconhecimento real exige microfone e serviço de voz; o teste de integração real com Just Sing exige backend e chave Gradium. Os testes automatizados usam transcrições e eventos simulados, incluindo o exemplo “All my dad Cry”.

Testes automatizados do alinhamento, eventos de reconhecimento, protocolo de áudio e liberação dos recursos: `node tests/lyrics-sing.test.cjs` (sem dependências externas).

Benchmark reproduzível da comparação local: `node tests/lyrics-sing.bench.cjs`. Ele usa textos sintéticos de 79 e 1.203 palavras e informa preparação, primeira comparação, mediana e percentil 95. Não mede áudio, rede, transcrição ou renderização e não é uma garantia de latência durante o canto.
