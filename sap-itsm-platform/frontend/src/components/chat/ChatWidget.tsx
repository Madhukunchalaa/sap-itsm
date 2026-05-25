import React, { useState, useRef, useEffect } from 'react';
import { MessageSquare, X, Send, Bot, User, Loader2, MinusCircle } from 'lucide-react';
import { chatApi } from '../../api/services';
import toast from 'react-hot-toast';

interface Message {
  role: 'user' | 'assistant';
  content: string;
}

export const ChatWidget: React.FC = () => {
  const [isOpen, setIsOpen] = useState(false);
  const [message, setMessage] = useState('');
  const [history, setHistory] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [history]);

  const handleSend = async () => {
    if (!message.trim() || isLoading) return;

    const userMessage = message;
    setMessage('');
    setIsLoading(true);

    try {
      const res = await chatApi.sendMessage(userMessage, history);
      setHistory(res.data.history);
    } catch (err: any) {
      toast.error('Failed to get response from AI');
      console.error(err);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="fixed bottom-6 left-6 z-50 flex flex-col items-start">
      {/* Chat Window */}
      {isOpen && (
        <div className="mb-4 flex h-[500px] w-[380px] flex-col overflow-hidden rounded-2xl bg-white shadow-2xl ring-1 ring-slate-200 animate-in slide-in-from-bottom-4 duration-300">
          {/* Header */}
          <div className="flex items-center justify-between bg-gradient-to-r from-blue-600 to-indigo-700 p-4 text-white">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-white/20 backdrop-blur-md">
                <Bot size={24} />
              </div>
              <div>
                <h3 className="font-semibold leading-tight">SAP ITSM Assistant</h3>
                <span className="text-xs text-blue-100 flex items-center gap-1">
                  <span className="h-1.5 w-1.5 rounded-full bg-green-400 animate-pulse"></span>
                  AI Agent Online
                </span>
              </div>
            </div>
            <button 
              onClick={() => setIsOpen(false)}
              className="rounded-full p-1 transition-colors hover:bg-white/10"
            >
              <X size={20} />
            </button>
          </div>

          {/* Messages */}
          <div className="flex-1 overflow-y-auto bg-slate-50 p-4 space-y-4 scrollbar-thin scrollbar-thumb-slate-200 scrollbar-track-transparent">
            {history.length === 0 && (
              <div className="flex flex-col items-center justify-center h-full text-center p-6 text-slate-500">
                <Bot size={48} className="mb-3 text-blue-200" />
                <p className="text-sm font-medium text-slate-600">Welcome to SAP ITSM Support</p>
                <p className="text-xs mt-1">I can help you create tickets, check status, or answer technical questions.</p>
                <div className="mt-4 flex flex-wrap justify-center gap-2">
                   {['Check my tickets', 'Create Incident'].map(btn => (
                     <button 
                       key={btn}
                       onClick={() => setMessage(btn)}
                       className="text-[10px] bg-white px-2.5 py-1.5 rounded-full border border-slate-200 shadow-sm hover:border-blue-300 hover:text-blue-600 transition-all"
                     >
                       {btn}
                     </button>
                   ))}
                </div>
              </div>
            )}
            
            {history.map((msg, i) => {
               // Anthropic history objects have complex structure, we need to extract text
               let content = '';
               if (msg.role === 'user') {
                 content = typeof msg.content === 'string' ? msg.content : msg.content[0]?.text || '';
               } else {
                 content = msg.content.find((c: any) => c.type === 'text')?.text || '';
               }

               if (!content) return null;

               return (
                <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                  <div className={`flex max-w-[85%] gap-2 ${msg.role === 'user' ? 'flex-row-reverse' : ''}`}>
                    <div className={`mt-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-white ${msg.role === 'user' ? 'bg-indigo-500' : 'bg-slate-700'}`}>
                      {msg.role === 'user' ? <User size={14} /> : <Bot size={14} />}
                    </div>
                    <div className={`rounded-2xl px-4 py-2.5 text-sm shadow-sm ${
                      msg.role === 'user' 
                        ? 'bg-blue-600 text-white rounded-tr-none' 
                        : 'bg-white text-slate-800 ring-1 ring-slate-100 rounded-tl-none'
                    }`}>
                      {content}
                    </div>
                  </div>
                </div>
               );
            })}
            
            {isLoading && (
              <div className="flex justify-start">
                <div className="flex max-w-[85%] gap-2">
                  <div className="mt-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-slate-700 text-white">
                    <Bot size={14} />
                  </div>
                  <div className="flex items-center gap-1 rounded-2xl bg-white px-4 py-3 ring-1 ring-slate-100 shadow-sm">
                    <span className="h-1.5 w-1.5 rounded-full bg-slate-300 animate-bounce"></span>
                    <span className="h-1.5 w-1.5 rounded-full bg-slate-300 animate-bounce [animation-delay:0.2s]"></span>
                    <span className="h-1.5 w-1.5 rounded-full bg-slate-300 animate-bounce [animation-delay:0.4s]"></span>
                  </div>
                </div>
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>

          {/* Input */}
          <div className="bg-white p-4 border-t border-slate-100">
            <div className="relative flex items-center">
              <input
                type="text"
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleSend()}
                placeholder="Ask me anything..."
                className="w-full rounded-xl border-0 bg-slate-100 py-3 pl-4 pr-12 text-sm text-slate-900 focus:ring-2 focus:ring-blue-500 transition-all"
              />
              <button
                onClick={handleSend}
                disabled={!message.trim() || isLoading}
                className="absolute right-2 rounded-lg bg-blue-600 p-2 text-white shadow-md transition-all hover:bg-blue-700 disabled:opacity-50 disabled:hover:bg-blue-600"
              >
                {isLoading ? <Loader2 size={18} className="animate-spin" /> : <Send size={18} />}
              </button>
            </div>
            <p className="mt-2 text-center text-[10px] text-slate-400">
              Powered by AI. Always verify critical information.
            </p>
          </div>
        </div>
      )}

      {/* FAB */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className={`flex h-14 w-14 items-center justify-center rounded-full shadow-lg transition-all duration-300 hover:scale-110 active:scale-95 ${
          isOpen ? 'bg-slate-800 text-white rotate-90' : 'bg-blue-600 text-white'
        }`}
      >
        {isOpen ? <MinusCircle size={28} /> : <MessageSquare size={28} />}
        {!isOpen && (
          <span className="absolute -top-1 -right-1 flex h-5 w-5 items-center justify-center rounded-full bg-red-500 text-[10px] font-bold text-white ring-2 ring-white">
            1
          </span>
        )}
      </button>
    </div>
  );
};
