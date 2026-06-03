import React, { useState, useEffect } from "react";
import {
  Users,
  Loader2,
  CheckCircle,
  AlertCircle,
  Shield,
  UserPlus,
} from "lucide-react";

export default function PainelAdmin() {
  const [usuarios, setUsuarios] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [novoEmail, setNovoEmail] = useState("");
  const [novaSenha, setNovaSenha] = useState("");
  const [criando, setCriando] = useState(false);
  const [sucesso, setSucesso] = useState("");

  const fetchUsuarios = async () => {
    try {
      const token = localStorage.getItem("kanon_token");
      const res = await fetch("/api/admin/usuarios", {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Erro ao buscar usuários");
      setUsuarios(data.usuarios || []);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchUsuarios();
  }, []);

  const handleToggleAtivo = async (id: string, currentStatus: boolean) => {
    try {
      const token = localStorage.getItem("kanon_token");
      const res = await fetch(`/api/admin/usuario/${id}/ativo`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ ativo: !currentStatus }),
      });
      if (!res.ok) throw new Error("Erro ao atualizar status");

      setUsuarios(
        usuarios.map((u) =>
          u.id === id ? { ...u, ativo: !currentStatus } : u,
        ),
      );
    } catch (err: any) {
      alert(err.message);
    }
  };

  const handleCreateUser = async (e: React.FormEvent) => {
    e.preventDefault();
    setCriando(true);
    setError("");
    setSucesso("");
    try {
      const token = localStorage.getItem("kanon_token");
      const res = await fetch("/api/admin/criar-usuario", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ email: novoEmail, password: novaSenha }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Erro ao criar usuário");

      setSucesso("Usuário criado com sucesso!");
      setNovoEmail("");
      setNovaSenha("");
      fetchUsuarios();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setCriando(false);
    }
  };

  if (loading)
    return (
      <div className="flex justify-center p-10">
        <Loader2 className="w-6 h-6 animate-spin text-[#D4AF37]" />
      </div>
    );

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div className="bg-[#111111] p-6 border border-white/10 flex items-center justify-between">
        <div className="flex items-center gap-3 text-[#D4AF37]">
          <Shield className="w-8 h-8" />
          <h2 className="text-xl font-display uppercase tracking-widest">
            Painel Administrativo
          </h2>
        </div>
        <div className="text-xs text-white/50 bg-white/5 px-3 py-1 uppercase tracking-wider font-sans border border-white/10">
          Acesso Restrito
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {/* Criar Usuário */}
        <div className="md:col-span-1 border border-white/10 bg-[#111111] p-5 h-fit">
          <div className="flex items-center gap-2 text-white pb-3 border-b border-white/10 mb-4">
            <UserPlus className="w-5 h-5 text-[#D4AF37]" />
            <h3 className="font-sans font-bold uppercase tracking-wider text-xs">
              Novo Usuário
            </h3>
          </div>

          <form onSubmit={handleCreateUser} className="space-y-4">
            <div>
              <label className="block text-[10px] uppercase tracking-wider text-white/60 mb-1.5">
                E-mail
              </label>
              <input
                type="email"
                required
                value={novoEmail}
                onChange={(e) => setNovoEmail(e.target.value)}
                className="w-full bg-black/50 border border-white/20 p-2 text-xs text-white placeholder-white/20"
              />
            </div>
            <div>
              <label className="block text-[10px] uppercase tracking-wider text-white/60 mb-1.5">
                Senha Provisória
              </label>
              <input
                type="password"
                required
                value={novaSenha}
                onChange={(e) => setNovaSenha(e.target.value)}
                className="w-full bg-black/50 border border-white/20 p-2 text-xs text-white placeholder-white/20"
              />
            </div>

            {error && <div className="text-red-400 text-[10px]">{error}</div>}
            {sucesso && (
              <div className="text-emerald-400 text-[10px]">{sucesso}</div>
            )}

            <button
              type="submit"
              disabled={criando}
              className="w-full bg-white/5 hover:bg-white/10 border border-white/10 p-2.5 text-xs text-white font-sans font-bold uppercase tracking-wider transition-colors flex items-center justify-center gap-2"
            >
              {criando ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                "Cadastrar"
              )}
            </button>
          </form>
        </div>

        {/* Lista de Usuários */}
        <div className="md:col-span-2 border border-white/10 bg-[#111111] p-5">
          <div className="flex items-center gap-2 text-white pb-3 border-b border-white/10 mb-4">
            <Users className="w-5 h-5 text-[#D4AF37]" />
            <h3 className="font-sans font-bold uppercase tracking-wider text-xs">
              Usuários do Sistema
            </h3>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs font-sans">
              <thead className="text-white/40 uppercase tracking-wider border-b border-white/10">
                <tr>
                  <th className="pb-3 font-medium">E-mail</th>
                  <th className="pb-3 font-medium">Role</th>
                  <th className="pb-3 font-medium">Plano</th>
                  <th className="pb-3 font-medium text-center">Status</th>
                  <th className="pb-3 font-medium text-right">Ação</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {usuarios.map((u) => (
                  <tr key={u.id} className="text-white/80">
                    <td className="py-3">{u.email}</td>
                    <td className="py-3 uppercase text-[10px] tracking-wide">
                      {u.role}
                    </td>
                    <td className="py-3 uppercase text-[10px] tracking-wide text-[#D4AF37]">
                      {u.plano}
                    </td>
                    <td className="py-3 text-center">
                      {u.ativo ? (
                        <span className="inline-flex items-center gap-1 text-emerald-400 text-[10px] uppercase">
                          <CheckCircle className="w-3 h-3" /> Ativo
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-red-400 text-[10px] uppercase">
                          <AlertCircle className="w-3 h-3" /> Inativo
                        </span>
                      )}
                    </td>
                    <td className="py-3 text-right">
                      <button
                        onClick={() => handleToggleAtivo(u.id, u.ativo)}
                        className="text-[10px] uppercase tracking-wider hover:text-white transition-colors"
                      >
                        {u.ativo ? "Inativar" : "Ativar"}
                      </button>
                    </td>
                  </tr>
                ))}
                {usuarios.length === 0 && (
                  <tr>
                    <td colSpan={5} className="py-6 text-center text-white/40">
                      Nenhum usuário encontrado
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
