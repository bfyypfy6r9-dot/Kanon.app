import express from "express";
import path from "path";
import fs from "fs";
import crypto from "crypto";
// @ts-ignore
import pdf from "pdf-parse";
import { GoogleGenAI } from "@google/genai";
import { Document, Paragraph, TextRun, AlignmentType, Packer } from "docx";
import { createServer as createViteServer } from "vite";

const app = express();
const PORT = 3000;

app.use(express.json());

// File paths
const USERS_FILE = path.join(process.cwd(), "users.json");
const BASE_TEOLOGICA_DIR = path.join(process.cwd(), "base_teologica");

// Ensure base_teologica directory exists
if (!fs.existsSync(BASE_TEOLOGICA_DIR)) {
  fs.mkdirSync(BASE_TEOLOGICA_DIR, { recursive: true });
}

// User Accounts helpers
function readUsers() {
  if (!fs.existsSync(USERS_FILE)) {
    return [];
  }
  try {
    const raw = fs.readFileSync(USERS_FILE, "utf-8");
    return JSON.parse(raw);
  } catch (err) {
    return [];
  }
}

function writeUsers(users: any[]) {
  fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2));
}

function hashPassword(password: string): string {
  return crypto.createHash("sha256").update(password).digest("hex");
}

// Theology context loader for RAG
async function loadTheologicalContext(): Promise<string> {
  const files = fs.readdirSync(BASE_TEOLOGICA_DIR);
  let context = "";

  for (const file of files) {
    const filePath = path.join(BASE_TEOLOGICA_DIR, file);
    const ext = path.extname(file).toLowerCase();

    try {
      if (ext === ".pdf") {
        const dataBuffer = fs.readFileSync(filePath);
        const parsed = await pdf(dataBuffer);
        context += `\n--- CONTEÚDO DO LIVRO/COMENTÁRIO: ${file} ---\n${parsed.text}\n`;
      } else if (ext === ".txt" || ext === ".md") {
        const content = fs.readFileSync(filePath, "utf-8");
        context += `\n--- CONTEÚDO DO LIVRO/COMENTÁRIO: ${file} ---\n${content}\n`;
      }
    } catch (err) {
      console.error(`Erro ao processar base de dados no arquivo: ${file}`, err);
    }
  }

  return context.trim();
}

// Parse text for footnotes markers e.g. [^1], [^2], converting them into TextRuns with superscripts for docx
function parseParagraphToRuns(text: string): TextRun[] {
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
      })
    );
  }

  return runs;
}

// Convert string elements into fully padded, indent-compliant docx formats
function createSermonParagraphs(text: string): Paragraph[] {
  if (!text) return [];
  // Split by newline and filter empty items
  const lines = text.split("\n").map(l => l.trim()).filter(l => l.length > 0);

  return lines.map(line => {
    return new Paragraph({
      alignment: AlignmentType.JUSTIFIED,
      spacing: {
        line: 360,    // 1.5 line spacing
        after: 140,   // standard padding
      },
      indent: {
        firstLine: 708, // 1.25 cm first-line indentation (approx 708 dxa)
      },
      children: parseParagraphToRuns(line),
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
          size: 20, // 10pt size (20 half-points)
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

// 1. Authentication Endpoints
app.post("/api/auth/register", (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ success: false, error: "E-mail e senha são obrigatórios." });
  }

  const users = readUsers();
  const exists = users.find((u: any) => u.email.toLowerCase() === email.toLowerCase());
  if (exists) {
    return res.status(400).json({ success: false, error: "Esta conta de e-mail já está registrada." });
  }

  const newUser = {
    email,
    passwordHash: hashPassword(password),
    registeredAt: new Date().toISOString()
  };

  users.push(newUser);
  writeUsers(users);

  res.json({ success: true, user: { email } });
});

app.post("/api/auth/login", (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ success: false, error: "E-mail e senha são obrigatórios." });
  }

  const users = readUsers();
  const user = users.find((u: any) => u.email.toLowerCase() === email.toLowerCase());
  if (!user || user.passwordHash !== hashPassword(password)) {
    return res.status(401).json({ success: false, error: "Credenciais inválidas. E-mail ou senha incorretos." });
  }

  res.json({ success: true, user: { email } });
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
    const rCtx = await loadTheologicalContext();

    // 2. Instantiate Gemini
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

    // 3. Formulate prompt incorporating RAG context and structure requirements
    const promptText = `
Você é um assistente teológico de altíssimo nível acadêmico e pastoral.
Seu objetivo é gerar o conteúdo de um sermão bíblico sob medida, utilizando exclusivamente as bases de comentários teológicos fornecidas abaixo.

CRITÉRIO CRÍTICO:
Siga rigorosamente estas instruções de fontes (RAG):
1. Use EXCLUSIVAMENTE o contexto dos documentos fornecidos abaixo.
2. NÃO invente doutrinas ou dados históricos sem embasamento direto nos textos de contexto.
3. Sempre que utilizar ou parafrasear uma ideia expressa nos comentários fornecidos, você DEVE citar inserindo uma marcação de nota de rodapé estilizada exatamente como [^1], [^2], [^3] no corpo do texto de forma sequencial.
4. No final de todo o texto gerado (após a seção de Apelo), você DEVE listar as fontes correspondentes em uma seção com o cabeçalho "Referências", descrevendo brevemente de qual autor/comentário e livro (dentre os citados no contexto oficial abaixo) aquela ideia foi obtida.

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
    ? "O usuário selecionou [Gerar com IA]. Crie uma Introdução impactante com base exclusiva no contexto teológico, introduzindo e contextualizando a passagem bíblica e o tema. Insira as notas de rodapé [^x] sequenciais de forma impecável."
    : `O usuário selecionou [Digitar Manualmente]. MANTENHA O TEXTO DIGITADO PELO AUTOR EXATAMENTE IGUAL: "${sections.introducao.text}" (Não mude sequer uma vírgula ou letra deste texto, replique-o fielmente). Se apropriado e se o texto tocar em ideias do contexto, você pode apenas inserir notas de rodapé no final das frases.`
}

Parte 2 - Desenvolvimento:
${
  sections.desenvolvimento.mode === "ai"
    ? `O usuário selecionou [Gerar com IA]. Crie o Desenvolvimento do sermão focado especificamente em exatamente ${numPoints || 3} pontos teológicos de ensinamento e pastorais detalhados, baseados rigorosamente na exegese contida nos comentários teológicos do contexto. Organize claramente cada um dos ${numPoints || 3} pontos de forma ordenada e numerada. Insira notas de rodapé [^x] apropriadas.`
    : `O usuário selecionou [Digitar Manualmente]. MANTENHA O TEXTO DIGITADO PELO AUTOR EXATAMENTE IGUAL: "${sections.desenvolvimento.text}" (Não altere este texto manual em hipótese alguma).`
}

Parte 3 - Conclusão:
${
  sections.conclusao.mode === "ai"
    ? "O usuário selecionou [Gerar com IA]. Crie uma Conclusão profunda e consolidada que amarre o sermão de volta ao tema e à passagem central. Insira as notas de rodapé [^x] correspondentes."
    : `O usuário selecionou [Digitar Manualmente]. MANTENHA O TEXTO DIGITADO PELO AUTOR EXATAMENTE IGUAL: "${sections.conclusao.text}" (Não mexa no texto digitado).`
}

Parte 4 - Apelo:
${
  sections.apelo.mode === "ai"
    ? "O usuário selecionou [Gerar com IA]. Crie um Apelo pastoral poderoso (uma chamada ética, transformação moral, de fé ou de ação comunitária) amparado no ensino textual exposto. Insira notas de rodapé [^x] se houver."
    : `O usuário selecionou [Digitar Manualmente]. MANTENHA O TEXTO DIGITADO PELO AUTOR EXATAMENTE IGUAL: "${sections.apelo.text}" (Mantenha-o intacto).`
}

----------------------------------------------------
CONTEXTO TEOLÓGICO SEGURO (Fórmula RAG):
${rCtx || "Nenhum livro de comentários eclesiásticos foi encontrado na pasta base_teologica. Como apoio teológico, use as verdades clássicas documentadas dos comentários de Romanos (Mclaren), Efésios, Salmo 23, Spurgeon e Matthew Henry que apoiam essa passagem."}
----------------------------------------------------

Por favor, escreva o sermão de modo estruturado e polido.
Para nos ajudar a parsear e modularizar o sermão no site, sua resposta DEVE seguir EXATAMENTE o formulário e os delimitadores abaixo no corpo de texto gerado:

[INTRODUCAO_START]
(Texto da introdução)
[INTRODUCAO_END]

[DESENVOLVIMENTO_START]
(Texto do desenvolvimento estruturado)
[DESENVOLVIMENTO_END]

[CONCLUSAO_START]
(Texto da conclusão)
[CONCLUSAO_END]

[APELO_START]
(Texto do apelo pastoral)
[APELO_END]

[REFERENCIAS_START]
(Lista numerada de Referências correspondentes no formato:
1. Comentário Exegético Maclaren - Vol II, pág. 112 [Romanos 8:1]
2. Comentário Bíblico de Genebra, Pág. 345 [Efésios 2:8])
[REFERENCIAS_END]

Rigor absoluto: O sermão deve soar coerente, articulado, respeitando estritamente a verdade teológica dos textos sem inventar.
`;

    // 4. Query model
    const response = await ai.models.generateContent({
      model: "gemini-3.5-flash",
      contents: promptText,
    });

    const parsedText = response.text || "";

    // 5. Slice responses back cleanly
    const extractedIntroducao = extractSection(parsedText, "[INTRODUCAO_START]", "[INTRODUCAO_END]") || (sections.introducao.mode === 'manual' ? sections.introducao.text : "Erro ao gerar introdução.");
    const extractedDesenvolvimento = extractSection(parsedText, "[DESENVOLVIMENTO_START]", "[DESENVOLVIMENTO_END]") || (sections.desenvolvimento.mode === 'manual' ? sections.desenvolvimento.text : "Erro ao gerar desenvolvimento.");
    const extractedConclusao = extractSection(parsedText, "[CONCLUSAO_START]", "[CONCLUSAO_END]") || (sections.conclusao.mode === 'manual' ? sections.conclusao.text : "Erro ao gerar conclusão.");
    const extractedApelo = extractSection(parsedText, "[APELO_START]", "[APELO_END]") || (sections.apelo.mode === 'manual' ? sections.apelo.text : "Erro ao gerar apelo.");
    const extractedReferencias = extractSection(parsedText, "[REFERENCIAS_START]", "[REFERENCIAS_END]") || "1. Banco de Dados Teológico Geral do Sistema.";

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
            spacing: { before: 200, after: 360 },
            children: [
              new TextRun({
                text: title.toUpperCase(),
                font: "Arial",
                size: 28, // 14pt size
                bold: true,
              }),
            ],
          }),

          // SUB-METADADOS
          new Paragraph({
            alignment: AlignmentType.CENTER,
            spacing: { after: 600 },
            children: [
              new TextRun({
                text: `Sermão Expositivo • Passagem Bíblica: ${passage} • Autor: ${author}`,
                font: "Arial",
                size: 24, // 12pt
                italics: true,
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
                text: "2. DESENVOLVIMENTO DO SERMÃO",
                font: "Arial",
                size: 24,
                bold: true,
              }),
            ],
          }),
          ...createSermonParagraphs(desenvolvimento),

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
                text: "4. APELO PASTORAL",
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
}

startServer();
