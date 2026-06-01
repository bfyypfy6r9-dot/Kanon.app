import React, { useState, useEffect } from "react";
import { 
  BookOpen, 
  User, 
  PenTool, 
  Download, 
  AlertCircle, 
  CheckCircle, 
  LogOut, 
  Lock, 
  FileText, 
  Loader2, 
  FileCheck,
  Award,
  BookMarked
} from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import { SermonResponse, UserSession } from "./types";

export default function App() {
  // Authentication state
  const [currentUser, setCurrentUser] = useState<UserSession | null>(null);
  const [authMode, setAuthMode] = useState<"login" | "register">("login");
  const [authEmail, setAuthEmail] = useState("");
  const [authPassword, setAuthPassword] = useState("");
  const [authError, setAuthError] = useState("");
  const [authSuccess, setAuthSuccess] = useState("");
  const [authLoading, setAuthLoading] = useState(false);

  // Form metadata states
  const [passage, setPassage] = useState("Romanos 8:1-4");
  const [author, setAuthor] = useState("Pr. João Santos");
  const [title, setTitle] = useState("A Liberdade Triunfante no Espírito de Deus");

  // Four sections state config
  const [introducaoMode, setIntroducaoMode] = useState<"ai" | "manual">("ai");
  const [introducaoText, setIntroducaoText] = useState("");

  const [desenvolvimentoMode, setDesenvolvimentoMode] = useState<"ai" | "manual">("ai");
  const [desenvolvimentoText, setDesenvolvimentoText] = useState("");
  const [desenvolvimentoPoints, setDesenvolvimentoPoints] = useState<number>(3);

  const [conclusaoMode, setConclusaoMode] = useState<"ai" | "manual">("ai");
  const [conclusaoText, setConclusaoText] = useState("");

  const [apeloMode, setApeloMode] = useState<"ai" | "manual">("ai");
  const [apeloText, setApeloText] = useState("");

  // UI state for sermon builder trigger
  const [generating, setGenerating] = useState(false);
  const [generatorError, setGeneratorError] = useState("");
  const [activeTab, setActiveTab] = useState<"introducao" | "desenvolvimento" | "conclusao" | "apelo" | "referencias">("introducao");
  const [sermonResult, setSermonResult] = useState<SermonResponse | null>(null);

  // Initialize session from localStorage
  useEffect(() => {
    const saved = localStorage.getItem("sermon_builder_session_v1");
    if (saved) {
      try {
        setCurrentUser(JSON.parse(saved));
      } catch (e) {
        localStorage.removeItem("sermon_builder_session_v1");
      }
    }
  }, []);

  // Handle Authentication submit
  const handleAuthSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthError("");
    setAuthSuccess("");
    
    if (!authEmail || !authPassword) {
      setAuthError("Forneça o e-mail e a senha.");
      return;
    }

    setAuthLoading(true);
    const endpoint = authMode === "login" ? "/api/auth/login" : "/api/auth/register";

    try {
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: authEmail, password: authPassword })
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Ocorreu um erro na autenticação.");
      }

      if (authMode === "register") {
        setAuthSuccess("Conta criada com sucesso! Faça login para utilizá-la.");
        setAuthMode("login");
        setAuthPassword("");
      } else {
        const session: UserSession = { email: data.user.email };
        localStorage.setItem("sermon_builder_session_v1", JSON.stringify(session));
        setCurrentUser(session);
        setAuthEmail("");
        setAuthPassword("");
        setAuthSuccess("Login efetuado com sucesso!");
      }
    } catch (err: any) {
      setAuthError(err.message || "Erro de conexão com o servidor.");
    } finally {
      setAuthLoading(false);
    }
  };

  // Sign out
  const handleSignOut = () => {
    localStorage.removeItem("sermon_builder_session_v1");
    setCurrentUser(null);
    setSermonResult(null);
  };

  // Build Sermon and generate Word ABNT document
  const handleBuildSermon = async () => {
    setGeneratorError("");
    setSermonResult(null);

    // ACTION BLOCK: If the user is NOT logged in, click to main button acts as a block and shows error modal.
    if (!currentUser) {
      setGeneratorError("Você precisa criar uma conta ou fazer login na barra lateral para gerar o sermão.");
      return;
    }

    if (!passage.trim() || !author.trim() || !title.trim()) {
      setGeneratorError("Por favor, preencha todos os campos de metadados (Passagem, Autor e Título).");
      return;
    }

    // Validation for manual texts
    if (introducaoMode === "manual" && !introducaoText.trim()) {
      setGeneratorError("Você escolheu Introdução Manual, digite o texto da introdução.");
      return;
    }
    if (desenvolvimentoMode === "manual" && !desenvolvimentoText.trim()) {
      setGeneratorError("Você escolheu Desenvolvimento Manual, digite o texto do desenvolvimento.");
      return;
    }
    if (conclusaoMode === "manual" && !conclusaoText.trim()) {
      setGeneratorError("Você escolheu Conclusão Manual, digite o texto da conclusão.");
      return;
    }
    if (apeloMode === "manual" && !apeloText.trim()) {
      setGeneratorError("Você escolheu Apelo Manual, digite o texto do apelo.");
      return;
    }

    setGenerating(true);

    try {
      const payload = {
        passage,
        author,
        title,
        numPoints: desenvolvimentoPoints,
        userEmail: currentUser.email,
        sections: {
          introducao: {
            mode: introducaoMode,
            text: introducaoMode === "manual" ? introducaoText : ""
          },
          desenvolvimento: {
            mode: desenvolvimentoMode,
            text: desenvolvimentoMode === "manual" ? desenvolvimentoText : ""
          },
          conclusao: {
            mode: conclusaoMode,
            text: conclusaoMode === "manual" ? conclusaoText : ""
          },
          apelo: {
            mode: apeloMode,
            text: apeloMode === "manual" ? apeloText : ""
          }
        }
      };

      const res = await fetch("/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Erro de compilação teológica no Gemini.");
      }

      setSermonResult(data);
      // Automatically focus first tab
      setActiveTab("introducao");
    } catch (err: any) {
      setGeneratorError(err.message || "Erro de conexão ao processar RAG teológico.");
    } finally {
      setGenerating(false);
    }
  };

  // Trigger Word DOCX download directly
  const handleDownloadDocx = () => {
    if (!sermonResult || !sermonResult.docxBase64) return;

    try {
      const binaryString = atob(sermonResult.docxBase64);
      const len = binaryString.length;
      const bytes = new Uint8Array(len);
      for (let i = 0; i < len; i++) {
        bytes[i] = binaryString.charCodeAt(i);
      }

      const blob = new Blob([bytes], {
        type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
      });

      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `Sermon_ABNT_${title.replace(/[^A-Za-z0-9]/g, "_")}.docx`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error("Erro ao baixar arquivo Word:", err);
      alert("Ocorreu um erro ao decodificar e baixar o arquivo Word.");
    }
  };

  return (
    <div className="min-h-screen bg-[#F4F1EA] text-[#1A1A1A] flex flex-col md:flex-row font-serif" id="app_root">
      
      {/* SIDEBAR DE AUTENTICAÇÃO E DETALHES INSPIRADA NA IDENTIDADE EDITORIAL BLACK */}
      <aside className="w-full md:w-[320px] bg-[#1A1A1A] text-[#F4F1EA] p-6 flex flex-col border-b md:border-b-0 md:border-r border-[#D1CEC5]/40" id="sidebar_container">
        
        {/* Cabecalho Lateral */}
        <div className="mb-10 pb-6 border-b border-white/10" id="sidebar_header">
          <h1 className="text-3xl font-display font-bold tracking-tight text-white leading-none">
            Kanon.app
          </h1>
        </div>

        {/* Informações de Autenticação */}
        <div className="flex-1 flex flex-col justify-between" id="auth_block">
          
          <div>
            <h3 className="text-[10px] uppercase tracking-widest text-[#D4AF37] font-bold mb-4 flex items-center gap-2 font-sans">
              <User className="w-3.5 h-3.5" />
              SISTEMA DE ACESSO
            </h3>

            {currentUser ? (
              // EXIBE USUÁRIO LOGADO - Ação ativa liberada
              <div className="bg-white/5 border border-white/10 p-4 mb-6" id="active_user_panel">
                <div className="flex items-center gap-3 mb-4">
                  <div className="w-9 h-9 bg-[#D4AF37]/15 text-[#D4AF37] flex items-center justify-center font-sans font-bold text-sm">
                    {currentUser.email.slice(0, 2).toUpperCase()}
                  </div>
                  <div className="overflow-hidden">
                    <p className="text-[9px] font-sans text-white/50 tracking-wider uppercase mb-0.5">Autorizado</p>
                    <p className="text-xs font-mono font-medium text-white truncate" title={currentUser.email}>
                      {currentUser.email}
                    </p>
                  </div>
                </div>
                
                <div className="flex items-center gap-1.5 text-[10px] text-emerald-400 bg-emerald-500/10 px-2.5 py-1.5 border border-emerald-500/20 mb-4 font-sans uppercase tracking-widest font-semibold">
                  <CheckCircle className="w-3.5 h-3.5 flex-shrink-0" />
                  <span>Acesso Pastoral Ativo</span>
                </div>

                <button
                  type="button"
                  onClick={handleSignOut}
                  className="w-full flex items-center justify-center gap-2 text-[10px] py-2.5 px-3 border border-white/20 hover:bg-white/5 text-white font-sans font-bold uppercase tracking-widest transition-colors cursor-pointer"
                  id="btn_logout"
                >
                  <LogOut className="w-3.5 h-3.5" />
                  Sair do Gabinete
                </button>
              </div>
            ) : (
              // SISTEMA DE FAZER LOGIN / CRIAR CONTA EM MODO EDITORIAL
              <div className="bg-white/5 p-5 border border-white/10" id="login_form_container">
                <div className="flex bg-black/40 p-1 border border-white/10 mb-4" id="auth_tabs">
                  <button
                    type="button"
                    onClick={() => { setAuthMode("login"); setAuthError(""); setAuthSuccess(""); }}
                    className={`flex-1 text-[10px] py-2 font-sans font-bold uppercase tracking-wider transition-all cursor-pointer ${
                      authMode === "login" 
                        ? "bg-[#D4AF37] text-black" 
                        : "text-white/60 hover:text-white"
                    }`}
                  >
                    Login
                  </button>
                  <button
                    type="button"
                    onClick={() => { setAuthMode("register"); setAuthError(""); setAuthSuccess(""); }}
                    className={`flex-1 text-[10px] py-2 font-sans font-bold uppercase tracking-wider transition-all cursor-pointer ${
                      authMode === "register" 
                        ? "bg-[#D4AF37] text-black" 
                        : "text-white/60 hover:text-white"
                    }`}
                  >
                    Registrar
                  </button>
                </div>

                <form onSubmit={handleAuthSubmit} className="space-y-4" id="credentials_form">
                  <div>
                    <label className="block text-[9px] uppercase tracking-wider text-white/65 font-sans mb-1.5">Endereço de E-mail</label>
                    <input
                      type="email"
                      required
                      value={authEmail}
                      onChange={(e) => setAuthEmail(e.target.value)}
                      placeholder="pastor@exemplo.com"
                      className="w-full bg-white/5 border border-white/20 p-2.5 text-xs text-white placeholder-white/20 font-sans focus:outline-none focus:border-white/50 transition-colors"
                    />
                  </div>

                  <div>
                    <label className="block text-[9px] uppercase tracking-wider text-white/65 font-sans mb-1.5">Senha Pastoral</label>
                    <input
                      type="password"
                      required
                      value={authPassword}
                      onChange={(e) => setAuthPassword(e.target.value)}
                      placeholder="••••••••"
                      className="w-full bg-white/5 border border-white/20 p-2.5 text-xs text-white placeholder-white/20 font-sans focus:outline-none focus:border-white/50 transition-colors"
                    />
                  </div>

                  {authError && (
                    <div className="bg-red-500/10 border border-red-500/30 text-red-300 p-3 text-xs flex items-start gap-1.5 font-sans">
                      <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
                      <span className="leading-snug">{authError}</span>
                    </div>
                  )}

                  {authSuccess && (
                    <div className="bg-emerald-500/10 border border-emerald-500/30 text-emerald-300 p-3 text-xs flex items-start gap-1.5 font-sans">
                      <CheckCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
                      <span className="leading-snug">{authSuccess}</span>
                    </div>
                  )}

                  <button
                    type="submit"
                    disabled={authLoading}
                    className="w-full bg-[#D4AF37] hover:bg-[#C19B2D] active:bg-[#AA8825] disabled:bg-neutral-800 text-black font-sans font-bold py-3 text-xs uppercase tracking-widest transition-all cursor-pointer flex items-center justify-center gap-2"
                  >
                    {authLoading ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : authMode === "login" ? (
                      "Acessar Sistema"
                    ) : (
                      "Criar Credencial"
                    )}
                  </button>
                </form>

                <p className="text-[10px] text-white/50 mt-4 leading-relaxed font-sans bg-black/20 p-3 border border-white/5">
                  <strong>Nota Teológica:</strong> Apenas pregadores autenticados podem submeter e-mails ao motor RAG para consulta de obras fixas.
                </p>
              </div>
            )}
          </div>

          {/* Rodapé Clássico da Barra Lateral */}
          <div className="mt-8 pt-6 border-t border-white/10" id="sidebar_footer">
            <div className="flex items-center gap-2 text-xs text-[#D4AF37] mb-2 font-display uppercase tracking-wide" id="theology_badge">
              <Award className="w-4 h-4" />
              <span>Cânon & Tradição</span>
            </div>
            <p className="text-[11px] text-white/60 leading-relaxed">
              "A tua palavra é lâmpada que ilumina os meus passos e luz que clareia o meu caminho." <span className="opacity-95 font-sans text-[10px] tracking-wider font-bold block mt-1">(Salmo 119:105)</span>
            </p>
          </div>

        </div>
      </aside>

      {/* PAINEL PRINCIPAL EM PARCHMENT STYLE */}
      <main className="flex-1 p-6 md:p-10 overflow-y-auto flex flex-col" id="main_panel">
        
        {/* CABEÇALHO COM ESTILO EDITORIAL E BORDAS FORTES */}
        <header className="mb-10 border-b border-[#D1CEC5] pb-8 flex flex-col lg:flex-row lg:items-end lg:justify-between gap-6" id="main_header">
          <div>
            <h1 className="text-4xl md:text-5xl font-extrabold tracking-tight font-serif text-[#1A1A1A] leading-tight">
              Kanon.app
            </h1>
          </div>

          <div className="flex flex-col items-start lg:items-end gap-3" id="user_action_badge">
            
            {currentUser ? (
              <span className="inline-flex items-center gap-1.5 px-3 py-1 font-sans text-[10px] uppercase tracking-wider font-semibold text-emerald-800 bg-emerald-100/60 border border-emerald-300">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-600"></span>
                Gabinete Liberado: {currentUser.email.split("@")[0]}
              </span>
            ) : (
              <span className="inline-flex items-center gap-1.5 px-3 py-1 font-sans text-[10px] uppercase tracking-wider font-semibold text-amber-800 bg-amber-100/60 border border-amber-300 animate-pulse">
                <span className="w-1.5 h-1.5 rounded-full bg-amber-600"></span>
                Consulta Bloqueada (Login pendente)
              </span>
            )}
          </div>
        </header>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 flex-1" id="dashboard_grid">
          
          {/* COLUNA DA ESQUERDA - CONFIGURAÇÃO DO SERMÃO */}
          <div className={`${sermonResult || generating ? "lg:col-span-7" : "lg:col-span-12"} space-y-6`} id="config_col">
            
            {/* CARD 1: DADOS BÁSICOS (METADADOS) EM ESTILO PARCHMENT */}
            <section className="bg-white border border-[#D1CEC5] p-6 shadow-xs" id="card_metadata">
              <h3 className="text-[10px] font-sans font-bold uppercase tracking-widest text-[#1A1A1A]/70 mb-6 flex items-center gap-2 pb-2 border-b border-[#D1CEC5]">
                <FileText className="w-4 h-4 text-[#8B7E66]" />
                1. Metadados do Sermão Expositivo
              </h3>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6" id="metadata_inputs_grid">
                <div>
                  <label className="block text-[10px] uppercase tracking-widest mb-1.5 font-sans font-bold text-[#1A1A1A]">Passagem Bíblica</label>
                  <input
                    type="text"
                    value={passage}
                    onChange={(e) => setPassage(e.target.value)}
                    placeholder="Ex: Efésios 2:8-10"
                    className="w-full bg-transparent border-b border-[#1A1A1A]/30 pb-2 text-sm text-[#1A1A1A] placeholder-[#1A1A1A]/40 focus:outline-[#D4AF37] transition-all font-serif"
                  />
                  <p className="text-[10px] text-[#8B7E66] mt-1.5">Livro, capítulo e versículos de apoio.</p>
                </div>

                <div>
                  <label className="block text-[10px] uppercase tracking-widest mb-1.5 font-sans font-bold text-[#1A1A1A]">Autor / Orador</label>
                  <input
                    type="text"
                    value={author}
                    onChange={(e) => setAuthor(e.target.value)}
                    placeholder="Ex: Rev. Silva"
                    className="w-full bg-transparent border-b border-[#1A1A1A]/30 pb-2 text-sm text-[#1A1A1A] placeholder-[#1A1A1A]/40 focus:outline-[#D4AF37] transition-all font-serif"
                  />
                  <p className="text-[10px] text-[#8B7E66] mt-1.5">Nome do teólogo que assina o sermão.</p>
                </div>

                <div className="md:col-span-2">
                  <label className="block text-[10px] uppercase tracking-widest mb-1.5 font-sans font-bold text-[#1A1A1A]">Título Temático do Sermão</label>
                  <input
                    type="text"
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    placeholder="Ex: A Suficiência da Graça"
                    className="w-full bg-transparent border-b border-[#1A1A1A]/30 pb-2 font-serif text-lg font-bold text-[#1A1A1A] placeholder-[#1A1A1A]/40 focus:outline-[#D4AF37] transition-all"
                  />
                  <p className="text-[10px] text-[#8B7E66] mt-1.5">O tema central ou ideia homilética norteadora.</p>
                </div>
              </div>
            </section>

            {/* CARD 2: CONFIGURAÇÃO DE ESTRUTURA HOMILÉTICA COM MATRIZ DE DESTAQUES */}
            <section className="space-y-4" id="card_structure">
              
              <div className="bg-white border border-[#D1CEC5] p-5 shadow-xs mb-6">
                <h3 className="text-[10px] font-sans font-bold uppercase tracking-widest text-[#1A1A1A]/70 flex items-center gap-2 pb-2 border-b border-[#D1CEC5]">
                  <PenTool className="w-4 h-4 text-[#8B7E66]" />
                  2. Matriz de Estruturação Homilética
                </h3>
                <p className="text-xs text-[#1A1A1A]/60 mt-2">
                  Selecione quais partes do discurso litúrgico deseja que o motor RAG de inteligência artificial escreva ou se você prefere digitar a sua própria exegese pessoal.
                </p>
              </div>

              {/* PARTE 1: INTRODUÇÃO */}
              <div className="border border-[#D1CEC5] p-5 bg-white shadow-sm flex flex-col transition-all hover:border-[#1A1A1A]" id="intro_config_wrap">
                <div className="flex justify-between items-center mb-4">
                  <h3 className="text-lg font-bold tracking-tight text-[#1A1A1A]">1. Introdução</h3>
                  <div className="flex gap-2 text-[9px] font-sans">
                    <button
                      type="button"
                      onClick={() => setIntroducaoMode("ai")}
                      className={`px-3 py-1 cursor-pointer font-bold transition-all ${
                        introducaoMode === "ai" 
                          ? "bg-[#1A1A1A] text-white" 
                          : "border border-[#D1CEC5] text-[#1A1A1A] opacity-50 hover:opacity-100"
                      }`}
                    >
                      GERAR COM IA
                    </button>
                    <button
                      type="button"
                      onClick={() => setIntroducaoMode("manual")}
                      className={`px-3 py-1 cursor-pointer font-bold transition-all ${
                        introducaoMode === "manual" 
                          ? "bg-[#1A1A1A] text-white" 
                          : "border border-[#D1CEC5] text-[#1A1A1A] opacity-50 hover:opacity-100"
                      }`}
                    >
                      MANUAL
                    </button>
                  </div>
                </div>

                {introducaoMode === "ai" ? (
                  <div className="bg-[#F9F8F5] border border-dashed border-[#D1CEC5] p-4 text-[11px] leading-relaxed text-[#1A1A1A]/65">
                    O motor RAG processará as referências da pasta <code className="bg-[#1A1A1A]/5 px-1 font-mono text-[10px] font-bold text-[#1A1A1A]">/base_teologica</code> para redigir uma introdução hermenêutica robusta baseada no contexto histórico.
                  </div>
                ) : (
                  <textarea
                    rows={3}
                    value={introducaoText}
                    onChange={(e) => setIntroducaoText(e.target.value)}
                    placeholder="Digite a síntese ou introdução teológica manualmente..."
                    className="w-full bg-[#F9F8F5] border border-[#D1CEC5]/40 p-3 text-xs focus:outline-none focus:border-[#D4AF37] text-[#1A1A1A] font-serif leading-relaxed"
                  />
                )}
              </div>

              {/* PARTE 2: DESENVOLVIMENTO COM DETALHES DE ESTILO EDITORIAL */}
              <div className="border border-[#1A1A1A] p-5 bg-white shadow-[6px_6px_0px_0px_rgba(26,26,26,0.05)] flex flex-col" id="dev_config_wrap">
                <div className="flex justify-between items-center mb-4">
                  <h3 className="text-lg font-bold tracking-tight text-[#1A1A1A]">2. Desenvolvimento</h3>
                  
                  <div className="flex items-center gap-4">
                    {desenvolvimentoMode === "ai" && (
                      <div className="flex items-center gap-2 border border-[#D1CEC5] px-2 py-1 bg-[#F9F8F5]">
                        <span className="text-[8px] font-bold uppercase text-[#8B7E66] font-sans">Argumentos</span>
                        <select
                          value={desenvolvimentoPoints}
                          onChange={(e) => setDesenvolvimentoPoints(Number(e.target.value))}
                          className="bg-transparent border-none text-[11px] font-bold font-sans cursor-pointer focus:outline-none text-[#1A1A1A]"
                        >
                          <option value={1}>1 Ponto</option>
                          <option value={2}>2 Pontos</option>
                          <option value={3}>3 Pontos</option>
                          <option value={4}>4 Pontos</option>
                          <option value={5}>5 Pontos</option>
                        </select>
                      </div>
                    )}

                    <div className="flex gap-2 text-[9px] font-sans">
                      <button
                        type="button"
                        onClick={() => setDesenvolvimentoMode("ai")}
                        className={`px-3 py-1 cursor-pointer font-bold transition-all ${
                          desenvolvimentoMode === "ai" 
                            ? "bg-[#1A1A1A] text-white" 
                            : "border border-[#D1CEC5] text-[#1A1A1A] opacity-50 hover:opacity-100"
                        }`}
                      >
                        GERAR COM IA
                      </button>
                      <button
                        type="button"
                        onClick={() => setDesenvolvimentoMode("manual")}
                        className={`px-3 py-1 cursor-pointer font-bold transition-all ${
                          desenvolvimentoMode === "manual" 
                            ? "bg-[#1A1A1A] text-white" 
                            : "border border-[#D1CEC5] text-[#1A1A1A] opacity-50 hover:opacity-100"
                        }`}
                      >
                        MANUAL
                      </button>
                    </div>
                  </div>
                </div>

                {desenvolvimentoMode === "ai" ? (
                  <div className="bg-[#F9F8F5] border border-dashed border-[#D1CEC5] p-4 text-[11px] leading-relaxed text-[#1A1A1A]/70">
                    <p className="font-bold font-sans uppercase text-[9px] tracking-wider text-[#8B7E66] mb-2">Configuração RAG Teológica Ativa:</p>
                    <ul className="list-disc list-inside space-y-1.5 font-serif text-xs">
                      <li>Análise minuciosa e exegese literária</li>
                      <li>Inclusão de notas de rodapé de referência [^n]</li>
                      <li>Consultas às obras canônicas da biblioteca local</li>
                    </ul>
                  </div>
                ) : (
                  <textarea
                    rows={4}
                    value={desenvolvimentoText}
                    onChange={(e) => setDesenvolvimentoText(e.target.value)}
                    placeholder="Escreva os pontos estruturados do desenvolvimento aqui..."
                    className="w-full bg-[#F9F8F5] border border-[#D1CEC5]/40 p-3 text-xs focus:outline-none focus:border-[#D4AF37] text-[#1A1A1A] font-serif leading-relaxed"
                  />
                )}
              </div>

              {/* PARTE 3: CONCLUSÃO */}
              <div className="border border-[#D1CEC5] p-5 bg-white shadow-sm flex flex-col transition-all hover:border-[#1A1A1A]" id="conclusion_config_wrap">
                <div className="flex justify-between items-center mb-4">
                  <h3 className="text-lg font-bold tracking-tight text-[#1A1A1A]">3. Conclusão</h3>
                  <div className="flex gap-2 text-[9px] font-sans">
                    <button
                      type="button"
                      onClick={() => setConclusaoMode("ai")}
                      className={`px-3 py-1 cursor-pointer font-bold transition-all ${
                        conclusaoMode === "ai" 
                          ? "bg-[#1A1A1A] text-white" 
                          : "border border-[#D1CEC5] text-[#1A1A1A] opacity-50 hover:opacity-100"
                      }`}
                    >
                      GERAR COM IA
                    </button>
                    <button
                      type="button"
                      onClick={() => setConclusaoMode("manual")}
                      className={`px-3 py-1 cursor-pointer font-bold transition-all ${
                        conclusaoMode === "manual" 
                          ? "bg-[#1A1A1A] text-white" 
                          : "border border-[#D1CEC5] text-[#1A1A1A] opacity-50 hover:opacity-100"
                      }`}
                    >
                      MANUAL
                    </button>
                  </div>
                </div>

                {conclusaoMode === "ai" ? (
                  <div className="bg-[#F9F8F5] border border-dashed border-[#D1CEC5] p-4 text-[11px] leading-relaxed text-[#1A1A1A]/65">
                    Gera a síntese exegética recapitulando os pontos ensinados de forma a consolidar a aplicação teológica literária.
                  </div>
                ) : (
                  <textarea
                    rows={3}
                    value={conclusaoText}
                    onChange={(e) => setConclusaoText(e.target.value)}
                    placeholder="Digite a síntese final do sermão aqui..."
                    className="w-full bg-[#F9F8F5] border border-[#D1CEC5]/40 p-3 text-xs focus:outline-none focus:border-[#D4AF37] text-[#1A1A1A] font-serif leading-relaxed"
                  />
                )}
              </div>

              {/* PARTE 4: APELO */}
              <div className="border border-[#D1CEC5] p-5 bg-white shadow-sm flex flex-col transition-all hover:border-[#1A1A1A]" id="apelo_config_wrap">
                <div className="flex justify-between items-center mb-4">
                  <h3 className="text-lg font-bold tracking-tight text-[#1A1A1A]">4. Apelo e Aplicação</h3>
                  <div className="flex gap-2 text-[9px] font-sans">
                    <button
                      type="button"
                      onClick={() => setApeloMode("ai")}
                      className={`px-3 py-1 cursor-pointer font-bold transition-all ${
                        apeloMode === "ai" 
                          ? "bg-[#1A1A1A] text-white" 
                          : "border border-[#D1CEC5] text-[#1A1A1A] opacity-50 hover:opacity-100"
                      }`}
                    >
                      GERAR COM IA
                    </button>
                    <button
                      type="button"
                      onClick={() => setApeloMode("manual")}
                      className={`px-3 py-1 cursor-pointer font-bold transition-all ${
                        apeloMode === "manual" 
                          ? "bg-[#1A1A1A] text-white" 
                          : "border border-[#D1CEC5] text-[#1A1A1A] opacity-50 hover:opacity-100"
                      }`}
                    >
                      MANUAL
                    </button>
                  </div>
                </div>

                {apeloMode === "ai" ? (
                  <div className="bg-[#F9F8F5] border border-dashed border-[#D1CEC5] p-4 text-[11px] leading-relaxed text-[#1A1A1A]/65">
                    Modo Assistente Ativo: Elaborará um apelo contundente, voltado à realidade espiritual e prática do rebanho contemporâneo.
                  </div>
                ) : (
                  <textarea
                    rows={3}
                    value={apeloText}
                    onChange={(e) => setApeloText(e.target.value)}
                    placeholder="Digite a aplicação prática pastoral aqui..."
                    className="w-full bg-[#F9F8F5] border border-[#D1CEC5]/40 p-3 text-xs focus:outline-none focus:border-[#D4AF37] text-[#1A1A1A] font-serif leading-relaxed"
                  />
                )}
              </div>

            </section>

            {/* BOTÃO EXECUTIVO PRINCIPAL ADAPTADO AO DESIGN SOLID RETRO EDITORIAL */}
            <footer className="mt-8 pt-6 border-t border-[#D1CEC5] flex flex-col gap-4" id="main_trigger_card">
              
              {generatorError && (
                <div className="bg-[#E23F3F]/10 border-2 border-[#E23F3F] text-[#E23F3F] p-4 text-xs flex items-start gap-2.5 font-sans tracking-wide">
                  <AlertCircle className="w-5 h-5 flex-shrink-0 mt-0.5 text-[#E23F3F]" />
                  <div>
                    <strong className="block uppercase tracking-wider text-[10px]">Ação Bloqueada ou Erro de Compilação</strong>
                    <span className="leading-relaxed block mt-1">{generatorError}</span>
                  </div>
                </div>
              )}

              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div className="flex flex-col gap-1.5">
                  <div className="flex items-center gap-2 text-[10px] font-sans">
                    <span className={`w-2 h-2 rounded-full ${currentUser ? "bg-emerald-600" : "bg-red-500"}`}></span>
                    <span className="font-bold uppercase tracking-wider">
                      {currentUser ? "Licença Pastoral Autorizada" : "Usuário Não Autenticado"}
                    </span>
                  </div>
                  <div className="flex items-center gap-2 text-[9px] font-sans opacity-60">
                    <span className="w-1.5 h-1.5 rounded-full bg-slate-400"></span>
                    <span className="uppercase tracking-tighter">Gemini-3.5-Flash RAG Active</span>
                  </div>
                </div>

                <div className="relative">
                  <button
                    type="button"
                    onClick={handleBuildSermon}
                    disabled={generating}
                    className="bg-[#1A1A1A] hover:bg-neutral-800 active:bg-black text-white px-8 py-4 font-sans font-bold text-xs uppercase tracking-[0.2em] transition-colors flex items-center justify-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed border border-[#1A1A1A] shadow-[4px_4px_0px_0px_rgba(0,0,0,0.15)]"
                    id="btn_build_sermon"
                  >
                    {generating ? (
                      <>
                        <Loader2 className="w-4 h-4 animate-spin" />
                        <span>Compilando...</span>
                      </>
                    ) : (
                      <span>Construir Sermão e Gerar ABNT</span>
                    )}
                  </button>
                </div>
              </div>
            </footer>

          </div>

          {/* COLUNA DA DIREITA - PREVIEW DOS RESULTADOS COM ENGENHARIA DE DESIGN PREMIUM */}
          {(sermonResult || generating) && (
            <div className="lg:col-span-5 space-y-6" id="preview_col">
              
              <AnimatePresence mode="wait">
                {generating ? (
                  // LOADING SCREEN DE PRESTÍGIO ACADÊMICO
                  <motion.div
                    initial={{ opacity: 0, y: 15 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -15 }}
                    className="bg-[#1A1A1A] text-[#F4F1EA] p-8 border-2 border-[#1A1A1A] flex flex-col justify-center items-center min-h-[450px]"
                    id="loading_panel"
                  >
                    <Loader2 className="w-12 h-12 text-[#D4AF37] animate-spin mb-6" />
                    <h4 className="text-xl font-display tracking-tight mb-2 text-white">Interpretando as Escrituras</h4>
                    <p className="text-white/60 text-xs max-w-sm leading-relaxed text-center font-serif mb-6">
                      Aguarde enquanto consultamos a nossa <span className="text-[#D4AF37] font-sans font-bold not-italic tracking-wider text-[10px]">base_teologica_local</span>. Estamos cruzando referências cruzadas e erguendo argumentos puritanos legítimos.
                    </p>
                    
                    <div className="w-full bg-[#F4F1EA]/10 border border-white/10 h-1.5 overflow-hidden max-w-[200px] mb-3">
                      <div className="bg-[#D4AF37] h-full w-2/3 animate-[pulse_1.5s_infinite]"></div>
                    </div>
                    <span className="text-[9px] font-sans uppercase tracking-[0.15em] opacity-40">Processamento Hermenêutico RAG</span>
                  </motion.div>
                ) : sermonResult ? (
                  // SUCESSO DO TRABALHO HISTÓRICO COM VISUALIZADOR RÍGIDO
                  <motion.div
                    initial={{ opacity: 0, scale: 0.98 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.98 }}
                    className="space-y-6"
                    id="result_panel"
                  >
                    
                    {/* CARD DE DOWNLOAD SUCESSO EM CORES DE DOCUMENTAÇÃO CIENTÍFICA */}
                    <div className="border-2 border-emerald-600 bg-emerald-50/50 p-6 shadow-sm">
                      <div className="flex gap-3 mb-4">
                        <div className="p-2 bg-emerald-600 text-white rounded-none flex items-center justify-center h-10 w-10 shrink-0" id="success_badge_icon">
                          <FileCheck className="w-5 h-5" id="success_ico" />
                        </div>
                        <div>
                          <h4 className="font-serif font-bold text-[#1A1A1A] text-lg leading-snug">Texto Homilético Construído!</h4>
                          <p className="text-xs text-[#1A1A1A]/70 mt-0.5">Formatado e embutido com notas de rodapé segundo os rigores da ABNT.</p>
                        </div>
                      </div>

                      <button
                        onClick={handleDownloadDocx}
                        className="w-full py-3 px-4 bg-[#1A1A1A] hover:bg-neutral-800 text-white font-sans font-bold text-xs uppercase tracking-widest transition-colors flex items-center justify-center gap-2 cursor-pointer shadow-[2px_2px_0px_0px_rgba(0,0,0,0.15)]"
                        id="btn_download_docx_main"
                      >
                        <Download className="w-4 h-4 text-[#D4AF37]" />
                        Baixar Arquivo Word (.DOCX ABNT)
                      </button>
                      
                      <div className="mt-3 text-[10px] text-emerald-950 font-sans leading-relaxed bg-emerald-500/10 p-3 border border-emerald-500/20">
                        📏 <strong>Configuração ABNT Aplicada:</strong> Fontes Arial 12pt, Margens 3x3x2x2cm, espaçamento de linha de 1.5, início de parágrafo recuado em 1.25cm e referências de fim/rodapé indexadas.
                      </div>
                    </div>

                    {/* TAB PREVIEW DO COMPILADO */}
                    <div className="border border-[#D1CEC5] bg-white shadow-sm overflow-hidden" id="tab_preview_container">
                      
                      <div className="bg-[#F9F8F5] p-3 border-b border-[#D1CEC5]">
                        <span className="text-[9px] uppercase font-sans font-bold tracking-widest text-[#8B7E66] block mb-2">Exame Prévio Litúrgico</span>
                        <div className="flex flex-wrap gap-1" id="preview_tab_header">
                          {(["introducao", "desenvolvimento", "conclusao", "apelo", "referencias"] as const).map((tab) => (
                            <button
                              key={tab}
                              onClick={() => setActiveTab(tab)}
                              className={`text-[9px] font-sans font-bold uppercase tracking-wider py-1.5 px-3 transition-colors cursor-pointer ${
                                activeTab === tab 
                                  ? "bg-[#1A1A1A] text-white" 
                                  : "text-[#1A1A1A]/70 hover:bg-[#D1CEC5]/30"
                              }`}
                            >
                              {tab === "introducao" ? "1. Introdução" :
                               tab === "desenvolvimento" ? "2. Desenv." :
                               tab === "conclusao" ? "3. Conclusão" :
                               tab === "apelo" ? "4. Apelo" : "Referências"}
                            </button>
                          ))}
                        </div>
                      </div>

                      <div className="p-6 md:p-8" id="preview_tab_body">
                        
                        <div className="font-sans text-[10px] uppercase tracking-widest text-[#8B7E66] mb-4 flex items-center justify-between pb-2 border-b border-dashed border-[#D1CEC5]">
                          <span>Amostra de Texto Impresso</span>
                          <span className="font-bold">Regras Físicas ABNT</span>
                        </div>

                        {activeTab === "introducao" && (
                          <div className="space-y-4" id="prev_intro">
                            <h4 className="text-xs font-sans font-bold tracking-widest uppercase text-[#8B7E66]">1. INTRODUÇÃO</h4>
                            <p className="text-sm text-[#1A1A1A] leading-8 text-justify indent-[1.25cm] whitespace-pre-line font-serif">
                              {sermonResult.introducao}
                            </p>
                          </div>
                        )}

                        {activeTab === "desenvolvimento" && (
                          <div className="space-y-4" id="prev_dev">
                            <h4 className="text-xs font-sans font-bold tracking-widest uppercase text-[#8B7E66]">2. DESENVOLVIMENTO</h4>
                            <div className="text-sm text-[#1A1A1A] leading-8 text-justify indent-[1.25cm] whitespace-pre-line font-serif">
                              {sermonResult.desenvolvimento}
                            </div>
                          </div>
                        )}

                        {activeTab === "conclusao" && (
                          <div className="space-y-4" id="prev_conclusion">
                            <h4 className="text-xs font-sans font-bold tracking-widest uppercase text-[#8B7E66]">3. CONCLUSÃO</h4>
                            <p className="text-sm text-[#1A1A1A] leading-8 text-justify indent-[1.25cm] whitespace-pre-line font-serif">
                              {sermonResult.conclusao}
                            </p>
                          </div>
                        )}

                        {activeTab === "apelo" && (
                          <div className="space-y-4" id="prev_apelo">
                            <h4 className="text-xs font-sans font-bold tracking-widest uppercase text-[#8B7E66]">4. APELO PASTORAL</h4>
                            <p className="text-sm text-[#1A1A1A] leading-8 text-justify indent-[1.25cm] whitespace-pre-line font-serif">
                              {sermonResult.apelo}
                            </p>
                          </div>
                        )}

                        {activeTab === "referencias" && (
                          <div className="space-y-4" id="prev_references">
                            <h4 className="text-xs font-sans font-bold tracking-widest uppercase text-center text-[#8B7E66]">Referências do Comentário Exegético</h4>
                            <div className="text-[11px] text-[#1A1A1A]/80 bg-[#F9F8F5] p-4 border border-[#D1CEC5] leading-relaxed text-justify whitespace-pre-line font-mono">
                              {sermonResult.referencias}
                            </div>
                          </div>
                        )}

                      </div>

                    </div>

                  </motion.div>
                ) : null}
              </AnimatePresence>

            </div>
          )}

        </div>

      </main>

    </div>
  );
}
