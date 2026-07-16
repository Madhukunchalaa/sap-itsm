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
    <>
      {/* Full Screen Chat Window */}
      {isOpen && (
        <div className="fixed inset-0 z-50 flex flex-col bg-white animate-in slide-in-from-bottom-8 duration-300">
          {/* Header */}
          <div className="flex items-center justify-between bg-white border-b border-slate-200 px-6 py-4">
            <div className="flex items-center gap-3">
              <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-blue-600 to-indigo-600 text-white shadow-sm">
                <Bot size={28} />
              </div>
              <div>
                <h3 className="font-bold text-slate-800 text-lg leading-tight">SAP ITSM Assistant</h3>
                <span className="text-sm text-slate-500 flex items-center gap-1.5 mt-0.5">
                  <span className="h-2 w-2 rounded-full bg-green-500 animate-pulse shadow-[0_0_8px_rgba(34,197,94,0.6)]"></span>
                  AI Agent Online
                </span>
              </div>
            </div>
            <button 
              onClick={() => setIsOpen(false)}
              className="rounded-full p-2.5 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700"
            >
              <X size={26} />
            </button>
          </div>

          {/* Messages */}
          <div className="flex-1 overflow-y-auto bg-slate-50/50 p-4 sm:p-8 space-y-8 scrollbar-thin scrollbar-thumb-slate-200 scrollbar-track-transparent">
            <div className="mx-auto max-w-4xl space-y-8">
              {history.length === 0 && (
                <div className="flex flex-col items-center justify-center h-[50vh] text-center p-6 text-slate-500">
                  <div className="h-24 w-24 rounded-full bg-blue-50 flex items-center justify-center mb-6 shadow-inner">
                    <Bot size={48} className="text-blue-500" />
                  </div>
                  <h2 className="text-2xl font-semibold text-slate-800 mb-2">How can I help you today?</h2>
                  <p className="text-base text-slate-500 max-w-md">I can help you create tickets, check status, or answer technical questions.</p>
                  <div className="mt-8 flex flex-wrap justify-center gap-3">
                     {['Check my tickets', 'Create Incident', 'Check SLA status'].map(btn => (
                       <button 
                         key={btn}
                         onClick={() => setMessage(btn)}
                         className="text-sm font-medium bg-white px-5 py-2.5 rounded-full border border-slate-200 shadow-sm hover:border-blue-300 hover:text-blue-600 hover:shadow-md transition-all active:scale-95"
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
                    <div className={`flex max-w-[85%] gap-4 ${msg.role === 'user' ? 'flex-row-reverse' : ''}`}>
                      <div className={`mt-1 flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-white shadow-sm ${msg.role === 'user' ? 'bg-indigo-500' : 'bg-gradient-to-br from-blue-600 to-indigo-600'}`}>
                        {msg.role === 'user' ? <User size={20} /> : <Bot size={20} />}
                      </div>
                      <div className={`rounded-3xl px-6 py-4 text-base shadow-sm ${
                        msg.role === 'user' 
                          ? 'bg-blue-600 text-white rounded-tr-sm' 
                          : 'bg-white text-slate-800 ring-1 ring-slate-100 rounded-tl-sm'
                      }`}>
                        {content}
                      </div>
                    </div>
                  </div>
                 );
              })}
              
              {isLoading && (
                <div className="flex justify-start">
                  <div className="flex max-w-[85%] gap-4">
                    <div className="mt-1 flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-white shadow-sm bg-gradient-to-br from-blue-600 to-indigo-600">
                      <Bot size={20} />
                    </div>
                    <div className="flex items-center gap-1.5 rounded-3xl bg-white px-6 py-5 ring-1 ring-slate-100 shadow-sm rounded-tl-sm">
                      <span className="h-2 w-2 rounded-full bg-slate-300 animate-bounce"></span>
                      <span className="h-2 w-2 rounded-full bg-slate-300 animate-bounce [animation-delay:0.2s]"></span>
                      <span className="h-2 w-2 rounded-full bg-slate-300 animate-bounce [animation-delay:0.4s]"></span>
                    </div>
                  </div>
                </div>
              )}
              <div ref={messagesEndRef} />
            </div>
          </div>

          {/* Input */}
          <div className="bg-white p-4 sm:p-6 border-t border-slate-100">
            <div className="mx-auto max-w-4xl relative">
              <div className="relative flex items-center shadow-lg rounded-2xl ring-1 ring-slate-200 bg-white">
                <input
                  type="text"
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleSend()}
                  placeholder="Message SAP ITSM Assistant..."
                  className="w-full rounded-2xl border-0 bg-transparent py-4 pl-6 pr-16 text-base text-slate-900 focus:ring-2 focus:ring-blue-500 transition-all placeholder:text-slate-400"
                />
                <button
                  onClick={handleSend}
                  disabled={!message.trim() || isLoading}
                  className="absolute right-3 rounded-xl bg-blue-600 p-2.5 text-white transition-all hover:bg-blue-700 disabled:opacity-50 disabled:hover:bg-blue-600 active:scale-95"
                >
                  {isLoading ? <Loader2 size={20} className="animate-spin" /> : <Send size={20} />}
                </button>
              </div>
              <p className="mt-3 text-center text-xs text-slate-400">
                AI Assistant can make mistakes. Consider verifying important information.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* FAB */}
      {!isOpen && (
        <div className="fixed bottom-6 left-6 z-50">
          <button
            onClick={() => setIsOpen(true)}
            className="flex h-14 w-14 items-center justify-center rounded-full shadow-lg transition-all duration-300 hover:scale-110 active:scale-95 bg-blue-600 text-white"
          >
            <MessageSquare size={28} />
            <span className="absolute -top-1 -right-1 flex h-5 w-5 items-center justify-center rounded-full bg-red-500 text-[10px] font-bold text-white ring-2 ring-white">
              1
            </span>
          </button>
        </div>
      )}
    </>
  );
};
