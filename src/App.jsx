import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Bot, Check, ChevronLeft, ChevronRight, Copy, Download, FileText, Menu, Mic, Moon,
  MoreHorizontal, PanelLeft, Pencil, Plus, RotateCcw, Search, Send, Settings, Sparkles,
  Sun, Trash2, Volume2, VolumeX, X, Phone, Square, AlertCircle,
} from 'lucide-react';

const STORAGE_KEY = 'nova-ai-conversations';
const THEME_KEY = 'nova-ai-theme';
const API_URL = (import.meta.env.VITE_API_URL || 'http://localhost:3001').replace(/\/$/, '');
const newConversation = () => ({ id: crypto.randomUUID(), title: 'New conversation', messages: [], updatedAt: Date.now() });

function MarkdownText({ text }) {
  const blocks = text.split(/```/g);
  return <div className="markdown">{blocks.map((block, index) => index % 2 === 1
    ? <pre key={index}><code>{block.replace(/^\w+\n/, '')}</code></pre>
    : block.split('\n').map((line, lineIndex) => <p key={`${index}-${lineIndex}`}>{line || '\u00a0'}</p>))}
  </div>;
}

function App() {
  const [conversations, setConversations] = useState(() => JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]'));
  const [activeId, setActiveId] = useState(() => conversations[0]?.id || null);
  const [input, setInput] = useState('');
  const [query, setQuery] = useState('');
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [theme, setTheme] = useState(() => localStorage.getItem(THEME_KEY) || 'dark');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const [listening, setListening] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [callState, setCallState] = useState('idle');
  const [callTranscript, setCallTranscript] = useState('');
  const recognitionRef = useRef(null);
  const liveSocketRef = useRef(null);
  const liveAudioContextRef = useRef(null);
  const liveStreamRef = useRef(null);
  const liveProcessorRef = useRef(null);
  const playbackTimeRef = useRef(0);
  const liveMutedRef = useRef(false);
  const liveReadyRef = useRef(false);
  const liveSetupTimeoutRef = useRef(null);
  const endRef = useRef(null);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(conversations));
    if (activeId && !conversations.some((item) => item.id === activeId)) setActiveId(conversations[0]?.id || null);
  }, [conversations, activeId]);
  useEffect(() => { document.documentElement.dataset.theme = theme; localStorage.setItem(THEME_KEY, theme); }, [theme]);
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [activeId, conversations, isLoading]);

  const active = conversations.find((item) => item.id === activeId);
  const visibleConversations = useMemo(() => conversations.filter((item) => item.title.toLowerCase().includes(query.toLowerCase())), [conversations, query]);
  const updateActive = (update) => setConversations((items) => items.map((item) => item.id === activeId ? { ...item, ...update, updatedAt: Date.now() } : item));
  const createChat = () => { const chat = newConversation(); setConversations((items) => [chat, ...items]); setActiveId(chat.id); setInput(''); setError(''); };
  const deleteChat = (id) => { setConversations((items) => items.filter((item) => item.id !== id)); if (id === activeId) setActiveId(null); };
  const renameChat = (chat) => { const title = window.prompt('Rename conversation', chat.title); if (title?.trim()) setConversations((items) => items.map((item) => item.id === chat.id ? { ...item, title: title.trim() } : item)); };

  const speak = (text) => {
    if (!('speechSynthesis' in window)) { setError('Speech synthesis is not supported in this browser.'); return; }
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.onstart = () => setSpeaking(true);
    utterance.onend = () => setSpeaking(false);
    window.speechSynthesis.speak(utterance);
  };
  const toggleListening = () => {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) { setError('Speech recognition is not supported here. Try Chrome or Edge, or type your message instead.'); return; }
    if (listening) { recognitionRef.current?.stop(); return; }
    const recognition = new SpeechRecognition();
    recognition.lang = 'en-US'; recognition.interimResults = true;
    recognition.onresult = (event) => setInput(Array.from(event.results).map((result) => result[0].transcript).join(''));
    recognition.onerror = () => { setError('Microphone recognition failed. Check browser permission and try again.'); setListening(false); };
    recognition.onend = () => setListening(false);
    recognitionRef.current = recognition; setListening(true); recognition.start();
  };
  const base64ToBytes = (value) => {
    const binary = window.atob(value);
    return Uint8Array.from(binary, (character) => character.charCodeAt(0));
  };
  const playLiveAudio = (base64) => {
    const context = liveAudioContextRef.current;
    if (!context) return;
    const bytes = base64ToBytes(base64);
    const samples = new Int16Array(bytes.buffer, bytes.byteOffset, Math.floor(bytes.byteLength / 2));
    const buffer = context.createBuffer(1, samples.length, 24000);
    const channel = buffer.getChannelData(0);
    for (let index = 0; index < samples.length; index += 1) channel[index] = samples[index] / 32768;
    const source = context.createBufferSource();
    source.buffer = buffer;
    source.connect(context.destination);
    const startAt = Math.max(context.currentTime, playbackTimeRef.current);
    source.start(startAt);
    playbackTimeRef.current = startAt + buffer.duration;
  };
  const downsampleToPcm16 = (input, inputRate) => {
    const outputRate = 16000;
    const ratio = inputRate / outputRate;
    const outputLength = Math.round(input.length / ratio);
    const output = new Int16Array(outputLength);
    for (let index = 0; index < outputLength; index += 1) {
      const sourceIndex = Math.min(Math.floor(index * ratio), input.length - 1);
      const sample = Math.max(-1, Math.min(1, input[sourceIndex]));
      output[index] = sample < 0 ? sample * 32768 : sample * 32767;
    }
    return btoa(String.fromCharCode(...new Uint8Array(output.buffer)));
  };
  const endLiveCall = () => {
    liveProcessorRef.current?.disconnect();
    liveProcessorRef.current = null;
    liveStreamRef.current?.getTracks().forEach((track) => track.stop());
    liveStreamRef.current = null;
    liveSocketRef.current?.close();
    liveSocketRef.current = null;
    if (liveSetupTimeoutRef.current) {
      window.clearTimeout(liveSetupTimeoutRef.current);
      liveSetupTimeoutRef.current = null;
    }
    liveAudioContextRef.current?.close();
    liveAudioContextRef.current = null;
    playbackTimeRef.current = 0;
    liveMutedRef.current = false;
    liveReadyRef.current = false;
    setCallState('idle');
  };
  const startLiveCall = async () => {
    if (callState === 'connected' || callState === 'connecting') { endLiveCall(); return; }
    if (!navigator.mediaDevices?.getUserMedia || !window.WebSocket) {
      setError('Live calling needs microphone and WebSocket support in Chrome or Edge.');
      return;
    }
    setError(''); setCallTranscript(''); setCallState('connecting');
    try {
      const tokenResponse = await fetch(`${API_URL}/api/live-token`, { method: 'POST' });
      const tokenData = await tokenResponse.json();
      if (!tokenResponse.ok) throw new Error(tokenData.error || 'Could not create a Live API session.');
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true } });
      const audioContext = new AudioContext();
      await audioContext.resume();
      const socket = new WebSocket(`wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContentConstrained?access_token=${encodeURIComponent(tokenData.token)}`);
      liveStreamRef.current = stream; liveAudioContextRef.current = audioContext; liveSocketRef.current = socket;
      socket.onopen = () => {
        socket.send(JSON.stringify({
          setup: {
            model: `models/${tokenData.model}`,
            generationConfig: { responseModalities: ['AUDIO'] },
            inputAudioTranscription: {},
            outputAudioTranscription: {},
          },
        }));
        liveSetupTimeoutRef.current = window.setTimeout(() => {
          if (!liveReadyRef.current) {
            setError('Gemini Live connected but did not finish setup. Check the Live model access and restart the server.');
            endLiveCall();
          }
        }, 10000);
        const source = audioContext.createMediaStreamSource(stream);
        const processor = audioContext.createScriptProcessor(4096, 1, 1);
        processor.onaudioprocess = (event) => {
          if (socket.readyState !== WebSocket.OPEN || !liveReadyRef.current || liveMutedRef.current) return;
          const audio = downsampleToPcm16(event.inputBuffer.getChannelData(0), audioContext.sampleRate);
          socket.send(JSON.stringify({ realtimeInput: { audio: { data: audio, mimeType: 'audio/pcm;rate=16000' } } }));
        };
        source.connect(processor); processor.connect(audioContext.destination); liveProcessorRef.current = processor;
      };
      socket.onmessage = async (event) => {
        const rawData = typeof event.data === 'string'
          ? event.data
          : event.data instanceof Blob
            ? await event.data.text()
            : new TextDecoder().decode(event.data);
        const response = JSON.parse(rawData);
        if (response.setupComplete) {
          if (liveSetupTimeoutRef.current) {
            window.clearTimeout(liveSetupTimeoutRef.current);
            liveSetupTimeoutRef.current = null;
          }
          liveReadyRef.current = true;
          setCallState('connected');
          return;
        }
        if (response.error) {
          setError(response.error.message || 'Gemini Live API returned an error.');
          endLiveCall();
          return;
        }
        const content = response.serverContent;
        if (content?.inputTranscription?.text) setCallTranscript((current) => `You: ${content.inputTranscription.text}`);
        if (content?.outputTranscription?.text) setCallTranscript((current) => `${current.split('\n')[0] || ''}\nNova: ${content.outputTranscription.text}`.trim());
        content?.modelTurn?.parts?.forEach((part) => { if (part.inlineData?.data) playLiveAudio(part.inlineData.data); });
        if (content?.interrupted && liveAudioContextRef.current) playbackTimeRef.current = liveAudioContextRef.current.currentTime;
      };
      socket.onerror = () => { setError('Live API connection failed. Check Live API model access and quota.'); endLiveCall(); };
      socket.onclose = () => { if (callState !== 'idle') endLiveCall(); };
    } catch (callError) {
      endLiveCall();
      setError(callError.message || 'Could not start live calling.');
    }
  };
  const toggleMute = () => {
    const track = liveStreamRef.current?.getAudioTracks()[0];
    if (!track) return;
    track.enabled = !track.enabled;
    liveMutedRef.current = !track.enabled;
    setCallState(track.enabled ? 'connected' : 'muted');
  };
  const sendMessage = async (event, forcedText) => {
    event?.preventDefault();
    const text = (forcedText ?? input).trim();
    if (!text || isLoading) return;
    let chat = active;
    if (!chat) { chat = newConversation(); setConversations((items) => [chat, ...items]); setActiveId(chat.id); }
    const userMessage = { id: crypto.randomUUID(), role: 'user', text };
    const history = chat.messages.map(({ role, text: messageText }) => ({ role: role === 'assistant' ? 'model' : role, text: messageText }));
    const title = chat.messages.length === 0 ? text.slice(0, 42) : chat.title;
    const nextMessages = [...chat.messages, userMessage];
    setConversations((items) => items.map((item) => item.id === chat.id ? { ...item, title, messages: nextMessages, updatedAt: Date.now() } : item));
    setInput(''); setError(''); setIsLoading(true);
    try {
      const response = await fetch(`${API_URL}/api/chat`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ message: text, history }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Request failed.');
      const assistantMessage = { id: crypto.randomUUID(), role: 'assistant', text: data.text };
      setConversations((items) => items.map((item) => item.id === chat.id ? { ...item, messages: [...nextMessages, assistantMessage], updatedAt: Date.now() } : item));
      speak(data.text);
    } catch (requestError) {
      setConversations((items) => items.map((item) => item.id === chat.id
        ? { ...item, title: chat.title, messages: chat.messages, updatedAt: Date.now() }
        : item));
      setError(requestError.message || 'Unable to reach the assistant.');
    }
    finally { setIsLoading(false); }
  };
  const regenerate = () => {
    if (!active?.messages.length) return;
    const lastUser = [...active.messages].reverse().find((message) => message.role === 'user');
    if (lastUser) { updateActive({ messages: active.messages.filter((message) => message.role !== 'assistant' || message.id !== active.messages.at(-1)?.id) }); sendMessage(null, lastUser.text); }
  };
  const handleComposerKeyDown = (event) => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); sendMessage(event); } };
  const exportChat = () => {
    if (!active) return;
    const content = active.messages.map((message) => `${message.role === 'user' ? 'You' : 'Nova'}:\n${message.text}`).join('\n\n');
    const url = URL.createObjectURL(new Blob([content], { type: 'text/plain' }));
    const link = document.createElement('a'); link.href = url; link.download = `${active.title.replace(/\W+/g, '-').toLowerCase() || 'nova-chat'}.txt`; link.click(); URL.revokeObjectURL(url);
  };

  return <div className="app-shell">
    <aside className={`sidebar ${sidebarOpen ? '' : 'collapsed'}`}>
      <div className="brand"><div className="brand-mark"><Sparkles size={18} /></div>{sidebarOpen && <strong>Nova<span>AI</span></strong>}<button className="icon-button sidebar-toggle" onClick={() => setSidebarOpen(!sidebarOpen)} aria-label="Toggle sidebar">{sidebarOpen ? <ChevronLeft size={18} /> : <ChevronRight size={18} />}</button></div>
      {sidebarOpen && <><button className="new-chat" onClick={createChat}><Plus size={18} /> New chat <span>⌘ K</span></button>
        <label className="search"><Search size={16} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search chats" /></label>
        <div className="history-heading"><span>Recent chats</span><MoreHorizontal size={17} /></div>
        <nav className="history">{visibleConversations.map((chat) => <div className={`history-item ${chat.id === activeId ? 'selected' : ''}`} key={chat.id} onClick={() => setActiveId(chat.id)}><FileText size={15} /><span>{chat.title}</span><button onClick={(event) => { event.stopPropagation(); renameChat(chat); }} aria-label="Rename"><Pencil size={13} /></button><button onClick={(event) => { event.stopPropagation(); deleteChat(chat.id); }} aria-label="Delete"><Trash2 size={13} /></button></div>)}</nav>
        <div className="sidebar-bottom"><button className="side-action" onClick={() => setSettingsOpen(true)}><Settings size={17} /> Settings</button><button className="side-action" onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}>{theme === 'dark' ? <Sun size={17} /> : <Moon size={17} />} {theme === 'dark' ? 'Light mode' : 'Dark mode'}</button><div className="profile"><div className="avatar">A</div><div><b>Guest user</b><small>Free plan</small></div><MoreHorizontal size={17} /></div></div>
      </>}
    </aside>
    <main className="main">
      <header className="topbar"><button className="icon-button mobile-menu" onClick={() => setSidebarOpen(!sidebarOpen)} aria-label="Open menu"><Menu size={20} /></button><div><p className="eyebrow">PERSONAL ASSISTANT</p><h1>{active?.title || 'Welcome to Nova AI'}</h1></div><div className="top-actions"><button className="icon-button" onClick={exportChat} disabled={!active} aria-label="Export chat"><Download size={18} /></button><button className="icon-button" onClick={() => setSettingsOpen(true)} aria-label="Settings"><Settings size={18} /></button></div></header>
      <section className="chat-area">
        {!active || active.messages.length === 0 ? <div className="welcome"><div className="welcome-icon"><Sparkles size={28} /></div><p className="eyebrow">YOUR THOUGHT PARTNER</p><h2>How can I help you<br /><em>today?</em></h2><p className="welcome-copy">Ask me anything, brainstorm ideas, or get help with your next big project.</p><div className="suggestions"><button onClick={() => sendMessage(null, 'Help me brainstorm ideas for a weekend project')}><span>💡</span><b>Brainstorm ideas</b><small>Get creative with me</small></button><button onClick={() => sendMessage(null, 'Explain quantum computing simply')}><span>🧠</span><b>Explain a concept</b><small>Make it easy to understand</small></button><button onClick={() => sendMessage(null, 'Help me write a professional email')}><span>✍️</span><b>Write something</b><small>Turn thoughts into words</small></button></div></div> : <div className="messages">{active.messages.map((message) => <article className={`message-row ${message.role}`} key={message.id}>{message.role === 'assistant' ? <div className="message-avatar"><Bot size={17} /></div> : <div className="message-avatar user-avatar">A</div>}<div className="message-content"><div className="message-meta"><b>{message.role === 'assistant' ? 'Nova' : 'You'}</b><span>{message.role === 'assistant' ? 'AI assistant' : 'Just now'}</span></div><MarkdownText text={message.text} />{message.role === 'assistant' && <div className="message-actions"><button onClick={() => navigator.clipboard?.writeText(message.text)}><Copy size={13} /> Copy</button><button onClick={() => speak(message.text)}><Volume2 size={13} /> Listen</button><button onClick={regenerate}><RotateCcw size={13} /> Regenerate</button></div>}</div></article>)}{isLoading && <div className="message-row assistant"><div className="message-avatar"><Bot size={17} /></div><div className="typing"><i></i><i></i><i></i></div></div>}<div ref={endRef} /></div>}
      </section>
      {error && <div className="error-banner"><AlertCircle size={16} />{error}<button onClick={() => setError('')}><X size={15} /></button></div>}
      <section className="composer-wrap"><div className="mode-row"><span><span className={`status-dot ${callState !== 'idle' ? 'live' : ''}`}></span> {callState === 'idle' ? 'Basic voice mode' : `Live call ${callState}`}</span><button onClick={startLiveCall}><Phone size={14} /> {callState === 'idle' ? 'Start live call' : 'End call'}</button></div>{callState !== 'idle' && <div className="call-panel"><div className="call-wave"><span></span><span></span><span></span><span></span><span></span></div><div><b>{callState === 'connecting' ? 'Connecting to Nova...' : 'Nova is listening'}</b><small>{callTranscript || 'Speak naturally. You can interrupt Nova at any time.'}</small></div><button onClick={toggleMute} className="call-control"><Mic size={16} /> {callState === 'muted' ? 'Unmute' : 'Mute'}</button><button onClick={endLiveCall} className="call-end"><Phone size={16} /></button></div>}<form className="composer" onSubmit={sendMessage}><textarea value={input} onChange={(event) => setInput(event.target.value)} onKeyDown={handleComposerKeyDown} placeholder="Message Nova..." rows="1" aria-label="Message Nova" /><button type="button" className={`mic-button ${listening ? 'active' : ''}`} onClick={toggleListening} aria-label={listening ? 'Stop listening' : 'Start voice input'}>{listening ? <Square size={17} /> : <Mic size={19} />}</button><button className="send-button" disabled={!input.trim() || isLoading} aria-label="Send message"><Send size={18} /></button></form><div className="composer-note">Nova can make mistakes. Check important information. <span>Press Enter to send · Shift + Enter for new line</span></div></section>
    </main>
    {settingsOpen && <div className="modal-backdrop" onClick={() => setSettingsOpen(false)}><section className="settings-modal" onClick={(event) => event.stopPropagation()}><div className="modal-header"><div><p className="eyebrow">PREFERENCES</p><h2>Settings</h2></div><button className="icon-button" onClick={() => setSettingsOpen(false)}><X size={18} /></button></div><div className="setting"><div><b>Appearance</b><small>Choose how Nova looks</small></div><button className="theme-toggle" onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}>{theme === 'dark' ? <><Moon size={15} /> Dark</> : <><Sun size={15} /> Light</>}</button></div><div className="setting"><div><b>Spoken responses</b><small>Read new AI replies aloud</small></div><button className={`switch ${speaking ? 'on' : ''}`} onClick={() => { if (speaking) window.speechSynthesis.cancel(); else if (active?.messages.at(-1)?.role === 'assistant') speak(active.messages.at(-1).text); }}><span></span></button></div><div className="call-info"><Phone size={18} /><div><b>Live AI calling</b><p>Uses a short-lived token and a direct Gemini Live WebSocket. Access depends on the configured project, model, and quota.</p></div></div></section></div>}
  </div>;
}

export default App;
