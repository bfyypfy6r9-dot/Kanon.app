import express from "express";
import path from "path";
import fs from "fs";
import crypto from "crypto";
import { GoogleGenAI } from "@google/genai";
import { Document, Paragraph, TextRun, AlignmentType, Packer } from "docx";
import { createServer as createViteServer } from "vite";

const app = express();
const PORT = 3000;

class Mutex {
  private queue: Promise<any> = Promise.resolve();

  async acquire(): Promise<() => void> {
    let release: () => void;
    const ticket = new Promise<void>((resolve) => {
      release = resolve;
    });

    const previous = this.queue;
    this.queue = previous.then(() => ticket).catch(() => ticket);

    await previous;
    return release!;
  }
}

const geminiMutex = new Mutex();

async function queryGeminiWithRetry(
  ai: GoogleGenAI,
  promptText: string,
  systemInstruction?: string,
  retries = 4,
  delayMs = 2500
): Promise<string> {
  let attempt = 0;
  let modelToUse = "gemini-3.5-flash";
  let hasFallenBack = false;

  while (attempt < retries) {
    try {
      if (attempt > 0) {
        const backoff = delayMs * Math.pow(2, attempt - 1);
        console.log(`[Gemini Retry] Tentativa ${attempt + 1}/${retries} usando o modelo "${modelToUse}" após delay de ${backoff}ms...`);
        await new Promise((resolve) => setTimeout(resolve, backoff));
      } else {
        // Delay mínimo garantido entre requisições sequenciais do mesmo fluxo
        await new Promise((resolve) => setTimeout(resolve, 2000));
      }

      const config: any = {
        temperature: 0,
      };
      if (systemInstruction) {
        config.systemInstruction = systemInstruction;
      }

      console.log(`[Gemini Request] Chamando modelo: "${modelToUse}", tentativa ${attempt + 1}`);
      const response = await ai.models.generateContent({
        model: modelToUse,
        contents: promptText,
        config: config,
      });

      return response.text || "";
    } catch (err: any) {
      attempt++;
      console.error(`[Gemini Error] Erro na tentativa ${attempt}/${retries} com o modelo "${modelToUse}":`, err);

      const errorMessage = err.message || "";
      const errorStatus = err.status || 0;

      // Verifica se é erro 503, 429 ou indicativo de sobrecarga (high demand / unavailable)
      const isTransient = 
        errorStatus === 503 || 
        errorStatus === 429 || 
        errorMessage.includes("503") || 
        errorMessage.includes("429") || 
        errorMessage.includes("demand") || 
        errorMessage.includes("UNAVAILABLE") || 
        !errorStatus;

      if (isTransient && attempt < retries) {
        // Se ainda não fizemos fallback e o erro é de sobrecarga/indisponibilidade (503),
        // fazemos o fallback automático para o modelo gemini-3.1-flash-lite para contornar o tráfego.
        if (!hasFallenBack && (errorStatus === 503 || errorMessage.includes("demand") || errorMessage.includes("UNAVAILABLE"))) {
          console.warn(`[Gemini Fallback] ATENÇÃO: "${modelToUse}" está congestionado. Chaveando de forma resiliente para "gemini-3.1-flash-lite" para garantir que o sermão seja gerado.`);
          modelToUse = "gemini-3.1-flash-lite";
          hasFallenBack = true;
          // Aguarda um pequeno instante extra e prossegue imediatamente
          await new Promise((resolve) => setTimeout(resolve, 1000));
        }
        continue;
      } else {
        throw err;
      }
    }
  }
  throw new Error("O serviço do Google Gemini está temporariamente indisponível após múltiplas tentativas. Por favor, tente novamente.");
}

app.use(express.json());

// File paths
const pastaBase = path.join(process.cwd(), "base_teologica");

// Ensure base_teologica directory exists
if (!fs.existsSync(pastaBase)) {
  fs.mkdirSync(pastaBase, { recursive: true });
}

function chunkText(text: string, source: string): { chunk: string; source: string }[] {
  const paragraphs = text.split(/\n\s*\n/);
  const chunks: { chunk: string; source: string }[] = [];
  let currentChunk = "";
  
  for (let para of paragraphs) {
    if (!para.trim()) continue;
    
    // If a single paragraph is extremely long, break it into smaller pieces
    while (para.length > 2000) {
       let piece = para.substring(0, 2000);
       para = para.substring(2000);
       
       if (currentChunk.length + piece.length > 2000) {
         if (currentChunk.trim()) {
           chunks.push({ chunk: currentChunk.trim(), source });
         }
         currentChunk = piece + "\n\n";
       } else {
         currentChunk += piece + "\n\n";
       }
    }

    if (currentChunk.length + para.length > 2000) {
      if (currentChunk.trim()) {
        chunks.push({ chunk: currentChunk.trim(), source });
      }
      currentChunk = para + "\n\n";
    } else {
      currentChunk += para + "\n\n";
    }
  }
  if (currentChunk.trim()) {
    chunks.push({ chunk: currentChunk.trim(), source });
  }
  return chunks;
}

// Theology context loader for RAG
async function loadTheologicalContext(passage: string, theme: string): Promise<string> {
  if (!fs.existsSync(pastaBase)) {
    return "";
  }
  
  const files = fs.readdirSync(pastaBase).filter(file => file.toLowerCase().endsWith(".txt"));
  const allChunks: { chunk: string; source: string }[] = [];
  
  for (const file of files) {
    const filePath = path.join(pastaBase, file);
    try {
      const content = fs.readFileSync(filePath, "utf-8");
      const fileChunks = chunkText(content, file);
      allChunks.push(...fileChunks);
    } catch (err: any) {
      console.error(`Erro ao processar base de dados no arquivo: ${file}. Detalhes: ${err.message}`, err);
    }
  }

  // 2. Mecanismo de Busca (Scoring)
  const searchTerms = [passage, theme].join(" ")
    .toLowerCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "") // remove accents
    .split(/\W+/)
    .filter(w => w.length > 3);
  
  const scoredChunks = allChunks.map(c => {
    const textLower = c.chunk.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
    let score = 0;
    for (const term of searchTerms) {
      const regex = new RegExp(`\\b${term}`, 'g');
      const matches = textLower.match(regex);
      if (matches) {
        score += matches.length;
      }
    }
    // Boost on exact passage phrase match
    if (passage && textLower.includes(passage.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, ""))) {
      score += 10;
    }
    return { ...c, score };
  });

  // Sort by highest score backwards
  scoredChunks.sort((a, b) => b.score - a.score);

  // 3. Limite de Segurança (Top-K) ~ 50,000 characters
  let accumulatedLength = 0;
  const selectedChunks = [];
  
  for (const item of scoredChunks) {
    const formattedChunk = `\n--- CONTEÚDO DO LIVRO/COMENTÁRIO: ${item.source} ---\n${item.chunk}\n`;
    if (accumulatedLength + formattedChunk.length > 50000) {
      break;
    }
    selectedChunks.push(formattedChunk);
    accumulatedLength += formattedChunk.length;
  }

  const context = selectedChunks.join("").trim();
  
  console.log(`RAG Local final: Retornando ${selectedChunks.length} chunks de ${allChunks.length} totais. Tamanho final: ${context.length} caracteres.`);
  
  return context;
}

// Parse text for footnotes markers e.g. [^1], [^2], converting them into TextRuns with superscripts for docx
function parseParagraphToRuns(text: string, forceBold: boolean = false): TextRun[] {
  const runs: TextRun[] = [];
  // Regex to extract footnotes [^1], [^2]
  const regex = /\[\^(\d+)\]/g;
  let lastIndex = 0;
  let match;

  while ((match = regex.exec(text)) !== null) {
    const matchIndex = match.index;
    
    // Append preceding plain text
    const plainText = text.substring(lastIndex, matchIndex);
    if (plainText) {
      runs.push(
        new TextRun({
          text: plainText,
          font: "Arial",
          size: 24, // 12pt (docx uses half-points)
          bold: forceBold || undefined,
        })
      );
    }

    // Append superscript foot index
    const fnIndex = match[1];
    runs.push(
      new TextRun({
        text: fnIndex,
        superScript: true,
        font: "Arial",
        size: 16, // smaller superscript size
        bold: true,
      })
    );

    lastIndex = regex.lastIndex;
  }

  // Append remaining text
  const remainingText = text.substring(lastIndex);
  if (remainingText) {
    runs.push(
      new TextRun({
        text: remainingText,
        font: "Arial",
        size: 24, // 12pt
        bold: forceBold || undefined,
      })
    );
  }

  return runs;
}

// Convert string elements into fully padded, indent-compliant docx formats
function createSermonParagraphs(text: string, isDevelopment: boolean = false): Paragraph[] {
  if (!text) return [];
  // Split by newline and filter empty items
  const lines = text.split("\n").map(l => l.trim()).filter(l => l.length > 0);

  return lines.map(line => {
    let isPoint = false;
    let processedText = line;

    // Check if line is inside Development and represents a main point (starts with Ponto or a number list item but not a/b/c sub-bullet)
    if (
      isDevelopment && 
      (/^(ponto|point)/i.test(line) || /^\d+[\.\-\s]+ponto/i.test(line) || (/^\d+\.?\s+[A-Z]/i.test(line) && !/^[a-zA-Z]\s*[\)\.]/i.test(line)))
    ) {
      isPoint = true;
      // Convert the line so only the First letter is uppercase, and everything else is lowercase
      processedText = line.charAt(0).toUpperCase() + line.slice(1).toLowerCase();
    }

    return new Paragraph({
      alignment: AlignmentType.JUSTIFIED,
      spacing: {
        line: 360,    // 1.5 line spacing
        after: 140,   // standard padding
      },
      indent: {
        firstLine: isPoint ? 0 : 708, // 1.25 cm first-line indentation
      },
      children: parseParagraphToRuns(processedText, isPoint),
    });
  });
}

function createReferenceParagraphs(text: string): Paragraph[] {
  if (!text) return [];
  const lines = text.split("\n").map(l => l.trim()).filter(l => l.length > 0);

  return lines.map(line => {
    return new Paragraph({
      alignment: AlignmentType.JUSTIFIED,
      spacing: {
        line: 240,   // Simple spacing for ABNT references
        after: 80,
      },
      indent: {
        firstLine: 0, // No indentation for references
      },
      children: [
        new TextRun({
          text: line,
          font: "Arial",
          size: 24, // 12pt size (24 half-points)
        }),
      ],
    });
  });
}

// Helper to reliably slice generated block markers from Gemini
function extractSection(text: string, startTag: string, endTag: string): string {
  const startIndex = text.indexOf(startTag);
  const endIndex = text.indexOf(endTag);

  if (startIndex !== -1 && endIndex !== -1) {
    return text.substring(startIndex + startTag.length, endIndex).trim();
  }

  // Fallback to match even if formatting was relaxed
  const cleanStart = startTag.replace("[", "").replace("]", "");
  const cleanEnd = endTag.replace("[", "").replace("]", "");
  const altStartIdx = text.indexOf(cleanStart);
  const altEndIdx = text.indexOf(cleanEnd);

  if (altStartIdx !== -1 && altEndIdx !== -1) {
    return text.substring(altStartIdx + cleanStart.length, altEndIdx).trim();
  }

  return "";
}

// ==================== API ENDPOINTS ====================

app.post("/api/generate-section", async (req, res) => {
  try {
    const { section, passage, author, title, numPoints, userEmail, generatedTexts } = req.body;

    if (!userEmail) {
      return res.status(401).json({ error: "Você precisa criar uma conta ou fazer login na barra lateral para gerar o sermão." });
    }

    if (!passage || !author || !title) {
      return res.status(400).json({ error: "Campos obrigatórios (Passagem, Autor e Título) ausentes." });
    }

    const rCtx = await loadTheologicalContext(passage, title);
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return res.status(500).json({ error: "A chave GEMINI_API_KEY não foi configurada nos segredos." });
    }

    const ai = new GoogleGenAI({
      apiKey: apiKey,
      httpOptions: {
        headers: {
          "User-Agent": "aistudio-build",
        },
      },
    });

    let systemInstruction = `Você atua como um processador de dados rigoroso para elaboração de sermões.
REGRA DE ALUCINAÇÃO ZERO (OBRIGATÓRIO):
Você deve criar o sermão utilizando ÚNICA E EXCLUSIVAMENTE o conteúdo de texto que foi fornecido a você nesta requisição (extraído dos arquivos da pasta base_teologica). Você tem amnésia total para qualquer conhecimento teológico externo. É terminantemente proibido inventar, deduzir ou adicionar referências bibliográficas, citações ou autores que não estejam literalmente escritos no texto fornecido.
REGRA DE FORMATAÇÃO (LAYOUT OBRIGATÓRIO):
Você é um assistente teológico profissional. A sua saída de texto deve ser rigorosamente limpa, acadêmica e seguir exatamente a estrutura do documento padrão abaixo.
REGRAS DE BLOQUEIO (NÃO FAÇA ISSO):
- NUNCA repita o título, autor ou texto bíblico no meio do sermão. Eles pertencem APENAS ao cabeçalho.
- NUNCA use formatação Markdown como #, ## ou *. Use apenas as tags HTML permitidas (<b> para negrito e <br> para quebra de linha).
- NUNCA crie textos corridos longos no Desenvolvimento. Use obrigatoriamente a estrutura de tópicos numerados seguidos de marcadores (bullet points ou •).

ESTRUTURA DE SAÍDA EXIGIDA:
Reproduza exatamente este esqueleto em todas as suas respostas, usando APENAS as seções que você foi solicitado a gerar (se estiver gerando apenas uma seção, retorne apenas ela formatada assim):

TEXTO - [Referência Bíblica]
[TÍTULO DO SERMÃO EM MAIÚSCULAS]
[Nome do Autor]

INTRODUÇÃO
[Primeiro parágrafo da introdução, direto ao assunto]
[Segundo parágrafo da introdução]
[Terceiro parágrafo da introdução]

DESENVOLVIMENTO
1. [Título do Primeiro Ponto Aqui]:
• [Primeira explicação, aplicação ou versículo de apoio]
• [Segunda explicação, aplicação ou versículo de apoio]
• [Terceira explicação, aplicação ou versículo de apoio]
(Continue a numeração em tags <b> até o limite de pontos necessários)

CONCLUSÃO
[Primeiro parágrafo da conclusão]
[Segundo parágrafo da conclusão]

APELO
• [Primeiro ponto do apelo final]
• [Segundo ponto do apelo final]

REFERÊNCIAS
[Liste os autores e materiais citados no texto base].`;

    let promptText = "";

    if (section === "introducao") {
      promptText = `
DADOS METADADOS DO SERMÃO DO CLIENTE:
- Passagem Bíblica Base: "${passage}"
- Autor do Sermão: "${author}"
- Título Temático: "${title}"

Gere a Introdução para este sermão em apenas um ou dois parágrafos.
Lembre-se de ir direto ao ponto, não escreva cabeçalhos de título ou autor.

CRITÉRIO CRÍTICO:
1. Use estritamente o contexto fornecido abaixo.
2. Siga as regras de formatação (sem markdown, sem símbolos).
3. A introdução deve conter exatamente 2 parágrafos.

CONTEXTO TEOLÓGICO SEGURO (RAG):
${rCtx || "Comentários teológicos clássicos."}
`;
    } else if (section === "desenvolvimento") {
      promptText = `
DADOS METADADOS DO SERMÃO DO CLIENTE:
- Passagem Bíblica Base: "${passage}"
- Autor do Sermão: "${author}"
- Título Temático: "${title}"

Gere o Desenvolvimento do sermão focado especificamente em exatamente ${numPoints || 3} pontos teológicos.
Lembre-se de ir direto ao ponto, não escreva cabeçalhos de título, comece direto pelo primeiro tópico.

Siga as regras de formatação estritas (sem blocos de código, sem marcações markdown e sem símbolos especiais).

CONTEXTO TEOLÓGICO SEGURO (RAG):
${rCtx || "Comentários teológicos clássicos."}
`;
    } else if (section === "conclusao") {
      promptText = `
DADOS METADADOS DO SERMÃO DO CLIENTE:
- Passagem Bíblica Base: "${passage}"
- Autor do Sermão: "${author}"
- Título Temático: "${title}"

Gere a Conclusão do sermão. Ela deve conter exatamente 2 (dois) parágrafos.
Lembre-se de ir direto ao ponto, não escreva o cabeçalho 'CONCLUSÃO'.

Siga as regras de formatação estritas (sem blocos de código, sem marcações markdown e sem símbolos especiais).

CONTEXTO TEOLÓGICO SEGURO (RAG):
${rCtx || "Comentários teológicos clássicos."}
`;
    } else if (section === "apelo") {
      promptText = `
DADOS METADADOS DO SERMÃO DO CLIENTE:
- Passagem Bíblica Base: "${passage}"
- Autor do Sermão: "${author}"
- Título Temático: "${title}"

Gere o Apelo do sermão. Ele deve conter exatamente 2 (dois) parágrafos.
Lembre-se de ir direto ao final, não escreva o cabeçalho 'APELO'.

Siga as regras de formatação estritas (sem blocos de código, sem marcações markdown e sem símbolos especiais).

CONTEXTO TEOLÓGICO SEGURO (RAG):
${rCtx || "Comentários teológicos clássicos."}
`;
    } else if (section === "referencias") {
      promptText = `
DADOS METADADOS DO SERMÃO DO CLIENTE:
- Passagem Bíblica Base: "${passage}"
- Autor do Sermão: "${author}"
- Título Temático: "${title}"

Gere a lista de referências consultadas no contexto. Formate como texto corrido ou linhas simples.
Lembre-se de não adicionar o título 'REFERÊNCIAS'.

Siga as regras de formatação estritas (sem blocos de código, sem marcações markdown e sem números entre colchetes).

CONTEXTO TEOLÓGICO SEGURO (RAG):
${rCtx || "Comentários teológicos clássicos."}
`;
    }

    const release = await geminiMutex.acquire();
    let responseText = "";
    try {
      responseText = await queryGeminiWithRetry(ai, promptText, systemInstruction);
    } finally {
      release();
    }

    res.json({ success: true, text: responseText });

  } catch (error: any) {
    console.error("Erro ao gerar seção:", error);
    if (error.status === 503 || error.message?.includes("503")) {
      res.status(503).json({ error: "O serviço de inteligência artificial está temporariamente indisponível (Erro 503). Por favor, tente novamente em instantes." });
    } else {
      res.status(500).json({ error: error.message || "Ocorreu um erro ao gerar esta seção." });
    }
  }
});

app.post("/api/bundle-docx", async (req, res) => {
  try {
    const { passage, author, title, introducao, desenvolvimento, conclusao, apelo, referencias, userEmail } = req.body;

    if (!userEmail) {
      return res.status(401).json({ error: "Não autorizado." });
    }

    const docBuffer = await createSermonDocx(
      passage,
      author,
      title,
      introducao,
      desenvolvimento,
      conclusao,
      apelo,
      referencias
    );

    const docxBase64 = docBuffer.toString("base64");
    res.json({ success: true, docxBase64 });
  } catch (error: any) {
    console.error("Erro ao empacotar DOCX:", error);
    res.status(500).json({ error: error.message || "Erro de formatação do documento DOCX." });
  }
});

// 2. Sermon Generation and RAG Engine Endpoint
app.post("/api/generate", async (req, res) => {
  try {
    const { passage, author, title, sections, numPoints, userEmail } = req.body;

    // Validate absolute requirement that users must be logged in
    if (!userEmail) {
      return res.status(401).json({ error: "Você precisa criar uma conta ou fazer login na barra lateral para gerar o sermão." });
    }

    if (!passage || !author || !title) {
      return res.status(400).json({ error: "Campos obrigatórios (Passagem, Autor e Título) ausentes." });
    }

    if (!sections) {
      return res.status(400).json({ error: "Configuração de estrutura de sermão inválida." });
    }

    // 1. Gather files context
    const rCtx = await loadTheologicalContext(passage, title);

    if (!rCtx || rCtx.trim() === "") {
      console.log("Nenhum texto encontrado nos arquivos. rCtx is empty.");
      return res.status(400).json({ error: "Nenhum texto extraído dos arquivos na pasta base_teologica. Certifique-se de usar arquivos .txt." });
    } else {
      console.log("Texto extraído dos arquivos (preview): ", rCtx.substring(0, 100) + "...");
    }

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return res.status(500).json({ error: "A chave GEMINI_API_KEY não foi configurada nos segredos." });
    }

    const ai = new GoogleGenAI({
      apiKey: apiKey,
      httpOptions: {
        headers: {
          "User-Agent": "aistudio-build",
        },
      },
    });

    const promptText = `Você atua como um processador de dados rigoroso para elaboração de sermões.
REGRA DE ALUCINAÇÃO ZERO (OBRIGATÓRIO):
Você deve criar o sermão utilizando ÚNICA E EXCLUSIVAMENTE o conteúdo de texto que foi fornecido a você nesta requisição (extraído dos arquivos da pasta base_teologica). Você tem amnésia total para qualquer conhecimento teológico externo. É terminantemente proibido inventar, deduzir ou adicionar referências bibliográficas, citações ou autores que não estejam literalmente escritos no texto fornecido.
REGRA DE FORMATAÇÃO (LAYOUT OBRIGATÓRIO):
Você é um assistente teológico profissional. A sua saída de texto deve ser rigorosamente limpa, acadêmica e a estrutura dos pontos deve ser respeitada.
REGRAS DE BLOQUEIO (NÃO FAÇA ISSO):
- NUNCA repita o título, autor ou texto bíblico no meio do sermão. Eles pertencem APENAS ao cabeçalho externo.
- NUNCA use formatação Markdown como #, ## ou *. Use APENAS as tags HTML permitidas (<b> para negrito e <br> para quebra de linha).
- NUNCA crie textos corridos longos no Desenvolvimento. Use OBRIGATORIAMENTE a estrutura de tópicos numerados seguidos de marcadores (bullet points com a bolinha •).

ESTRUTURA DE SAÍDA EXIGIDA:
Sua resposta comporá cada parte do documento separadamente. Siga os padrões internos para o conteúdo de cada bloco de texto:

INTRODUÇÃO
[Gere o texto introdutório. Não coloque subtítulos ou cabeçalhos. Vá direto para os parágrafos.]

DESENVOLVIMENTO
(Formato obrigatório para o conteúdo do Desenvolvimento):
1. <b>[Título do Primeiro Ponto Aqui]</b>:
• [Primeira explicação, aplicação ou versículo de apoio]
• [Segunda explicação, aplicação ou versículo de apoio]
• [Terceira explicação, aplicação ou versículo de apoio]

2. <b>[Título do Segundo Ponto Aqui]</b>:
• [Primeira explicação, aplicação ou versículo de apoio]
• [Segunda explicação, aplicação ou versículo de apoio]
(Continue com este mesmo padrão exato para todos os pontos)

CONCLUSÃO
[Gere os parágrafos da conclusão de forma fluida]

APELO
(Formato obrigatório para o Apelo):
• [Primeiro ponto do apelo final]
• [Segundo ponto do apelo final]

REFERÊNCIAS
[Liste os autores e materiais citados APENAS SE houver referências. Siga como texto corrido na base, sem marcadores de asterisco ou chaves].

DADOS METADADOS DO SERMÃO DO CLIENTE:
- Passagem Bíblica Base: "${passage}"
- Autor do Sermão: "${author}"
- Título Temático: "${title}"

CONVENÇÃO DE SEÇÕES DE CONTEÚDO:
As quatro partes fundamentais do sermão são: Introdução, Desenvolvimento, Conclusão, Apelo.
Abaixo estão as especificações para cada uma delas. Algumas partes foram redigidas manualmente pelo próprio pastor (e você DEVE mantê-las inalteradas), enquanto outras partes estão identificadas com "GERAR COM IA" (e você DEVE criá-las do zero usando os textos de contexto teológico fornecidos).

ESPECIFICAÇÕES DE CADA PARTE DA ESTRUTURA:

Parte 1 - Introdução:
${
  sections.introducao.mode === "ai"
    ? "O usuário selecionou Gerar com IA. Crie a Introdução. Crie uma Introdução impactante com base exclusiva no contexto teológico, introduzindo e contextualizando a passagem bíblica e o tema. A introdução deve ser curta, contendo exatamente 2 (dois) parágrafos. NÃO escreva título ou autor nela."
    : "O usuário selecionou Digitar Manualmente. MANTENHA O TEXTO DIGITADO PELO AUTOR EXATAMENTE IGUAL: \"" + sections.introducao.text + "\" (Não mude sequer uma vírgula ou letra deste texto, replique-o fielmente)."
}

Parte 2 - Desenvolvimento:
${
  sections.desenvolvimento.mode === "ai"
    ? "O usuário selecionou Gerar com IA. Crie o Desenvolvimento do sermão focado especificamente em exatamente " + (numPoints || 3) + " pontos teológicos detalhados. NÃO escreva a palavra 'Desenvolvimento', comece direto do primeiro ponto numerado."
    : "O usuário selecionou Digitar Manualmente. MANTENHA O TEXTO DIGITADO PELO AUTOR EXATAMENTE IGUAL: \"" + sections.desenvolvimento.text + "\" (Não altere este texto manual em hipótese alguma)."
}

Parte 3 - Conclusão:
${
  sections.conclusao.mode === "ai"
    ? "O usuário selecionou Gerar com IA. Crie uma Conclusão profunda e consolidada em exatamente 2 (dois) parágrafos. NÃO escreva a palavra 'Conclusão', comece o texto direto."
    : "O usuário selecionou Digitar Manualmente. MANTENHA O TEXTO DIGITADO PELO AUTOR EXATAMENTE IGUAL: \"" + sections.conclusao.text + "\" (Não mexa no texto digitado)."
}

Parte 4 - Apelo:
${
  sections.apelo.mode === "ai"
    ? "O usuário selecionou Gerar com IA. Crie um Apelo pastoral poderoso em exatamente 2 (dois) parágrafos. NÃO escreva o encabeçamento 'Apelo', comece com os tópicos direto."
    : "O usuário selecionou Digitar Manualmente. MANTENHA O TEXTO DIGITADO PELO AUTOR EXATAMENTE IGUAL: \"" + sections.apelo.text + "\" (Mantenha-o intacto)."
}

----------------------------------------------------
CONTEXTO TEOLÓGICO SEGURO (Fórmula RAG):
${rCtx}
----------------------------------------------------

Por favor, escreva o sermão de modo estruturado e polido.
Para nos ajudar a parsear e modularizar o sermão no site, sua resposta DEVE seguir EXATAMENTE o formulário e os delimitadores HTML abaixo no corpo de texto gerado, sem NENHUM caractere markdown como chaves, parênteses ou colchetes:

<INTRODUCAO_START>
(Texto da introdução)
<INTRODUCAO_END>

<DESENVOLVIMENTO_START>
(Texto do desenvolvimento estruturado)
<DESENVOLVIMENTO_END>

<CONCLUSAO_START>
(Texto da conclusão)
<CONCLUSAO_END>

<APELO_START>
(Texto do apelo pastoral)
<APELO_END>

<REFERENCIAS_START>
(Lista de Referências correspondentes no formato:
Comentário Exegético Maclaren - Vol II, pág. 112 Romanos 8:1
Comentário Bíblico de Genebra, Pág. 345 Efésios 2:8)
<REFERENCIAS_END>

Rigor absoluto: O sermão deve soar coerente, articulado, respeitando estritamente a verdade teológica dos textos sem inventar.
`;

    // 4. Query model serializado na mesma fila global para proteger a API do Gemini
    const release = await geminiMutex.acquire();
    let responseText = "";
    try {
      responseText = await queryGeminiWithRetry(ai, promptText);
    } finally {
      release();
    }

    const parsedText = responseText;

    // 5. Slice responses back cleanly
    const extractedIntroducao = extractSection(parsedText, "<INTRODUCAO_START>", "<INTRODUCAO_END>") || (sections.introducao.mode === 'manual' ? sections.introducao.text : "Erro ao gerar introdução.");
    const extractedDesenvolvimento = extractSection(parsedText, "<DESENVOLVIMENTO_START>", "<DESENVOLVIMENTO_END>") || (sections.desenvolvimento.mode === 'manual' ? sections.desenvolvimento.text : "Erro ao gerar desenvolvimento.");
    const extractedConclusao = extractSection(parsedText, "<CONCLUSAO_START>", "<CONCLUSAO_END>") || (sections.conclusao.mode === 'manual' ? sections.conclusao.text : "Erro ao gerar conclusão.");
    const extractedApelo = extractSection(parsedText, "<APELO_START>", "<APELO_END>") || (sections.apelo.mode === 'manual' ? sections.apelo.text : "Erro ao gerar apelo.");
    const extractedReferencias = extractSection(parsedText, "<REFERENCIAS_START>", "<REFERENCIAS_END>") || "Nenhuma referência encontrada.";

    // 6. Build the actual high-fidelity DOCX document locally
    const docBuffer = await createSermonDocx(
      passage,
      author,
      title,
      extractedIntroducao,
      extractedDesenvolvimento,
      extractedConclusao,
      extractedApelo,
      extractedReferencias
    );

    const docxBase64 = docBuffer.toString("base64");

    // Return the segmented details and Word base64 file to the user
    res.json({
      success: true,
      introducao: extractedIntroducao,
      desenvolvimento: extractedDesenvolvimento,
      conclusao: extractedConclusao,
      apelo: extractedApelo,
      referencias: extractedReferencias,
      docxBase64: docxBase64,
    });

  } catch (error: any) {
    console.error("Erro na geração do sermão RAG:", error);
    res.status(500).json({ error: error.message || "Ocorreu um erro interno na geração do sermão." });
  }
});

// Create DOCX wrapper
function createSermonDocx(
  passage: string,
  author: string,
  title: string,
  introducao: string,
  desenvolvimento: string,
  conclusao: string,
  apelo: string,
  referencias: string
): Promise<Buffer> {
  const doc = new Document({
    sections: [
      {
        properties: {
          page: {
            margin: {
              top: 1701,    // 3 cm (in twips/dxa)
              bottom: 1134, // 2 cm
              left: 1701,   // 3 cm
              right: 1134,  // 2 cm
            },
          },
        },
        children: [
          // CABEÇALHO DO TÍTULO EM MAIÚSCULO E NEGRITO
          new Paragraph({
            alignment: AlignmentType.CENTER,
            spacing: { before: 200, after: 240 },
            children: [
              new TextRun({
                text: title.toUpperCase(),
                font: "Arial",
                size: 24, // 12pt size
                bold: true,
              }),
            ],
          }),

          // NOME DO AUTOR ALINHADO À DIREITA E EM ITÁLICO
          new Paragraph({
            alignment: AlignmentType.RIGHT,
            spacing: { after: 120 },
            children: [
              new TextRun({
                text: author,
                font: "Arial",
                size: 24, // 12pt size
                italics: true,
              }),
            ],
          }),

          // PASSAGEM BÍBLICA ALINHADA À ESQUERDA (ABAIXO DO AUTOR)
          new Paragraph({
            alignment: AlignmentType.LEFT,
            spacing: { after: 480 },
            children: [
              new TextRun({
                text: passage,
                font: "Arial",
                size: 24, // 12pt
              }),
            ],
          }),

          // SEÇÃO 1: INTRODUÇÃO
          new Paragraph({
            alignment: AlignmentType.LEFT,
            spacing: { before: 400, after: 180 },
            children: [
              new TextRun({
                text: "1. INTRODUÇÃO",
                font: "Arial",
                size: 24,
                bold: true,
              }),
            ],
          }),
          ...createSermonParagraphs(introducao),

          // SEÇÃO 2: DESENVOLVIMENTO
          new Paragraph({
            alignment: AlignmentType.LEFT,
            spacing: { before: 400, after: 180 },
            children: [
              new TextRun({
                text: "2. DESENVOLVIMENTO",
                font: "Arial",
                size: 24,
                bold: true,
              }),
            ],
          }),
          ...createSermonParagraphs(desenvolvimento, true),

          // SEÇÃO 3: CONCLUSÃO
          new Paragraph({
            alignment: AlignmentType.LEFT,
            spacing: { before: 400, after: 180 },
            children: [
              new TextRun({
                text: "3. CONCLUSÃO",
                font: "Arial",
                size: 24,
                bold: true,
              }),
            ],
          }),
          ...createSermonParagraphs(conclusao),

          // SEÇÃO 4: APELO
          new Paragraph({
            alignment: AlignmentType.LEFT,
            spacing: { before: 400, after: 180 },
            children: [
              new TextRun({
                text: "4. APELO",
                font: "Arial",
                size: 24,
                bold: true,
              }),
            ],
          }),
          ...createSermonParagraphs(apelo),

          // SEÇÃO REFERÊNCIAS
          new Paragraph({
            alignment: AlignmentType.CENTER,
            spacing: { before: 600, after: 240 },
            children: [
              new TextRun({
                text: "REFERÊNCIAS",
                font: "Arial",
                size: 24,
                bold: true,
              }),
            ],
          }),
          ...createReferenceParagraphs(referencias),
        ],
      },
    ],
  });

  return Packer.toBuffer(doc);
}

// ==================== ASSET HANDLING & MIDDLEWARES ====================

async function startServer() {
  try {
    if (process.env.NODE_ENV !== "production") {
      const vite = await createViteServer({
        server: { middlewareMode: true },
        appType: "spa",
      });
      app.use(vite.middlewares);
    } else {
      const distPath = path.join(process.cwd(), "dist");
      app.use(express.static(distPath));
      app.get("*", (req, res) => {
        res.sendFile(path.join(distPath, "index.html"));
      });
    }

    app.listen(PORT, "0.0.0.0", () => {
      console.log(`Server HTTP rodando com sucesso na porta ${PORT}`);
    });
  } catch (err) {
    console.error("Critical error during server startup:", err);
  }
}

startServer();
