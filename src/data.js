// Dati condivisi dell'interfaccia: categorie, colori, icone, controllo privacy.

export const CATS = {
  banconote: 'Banconote false', pagamento: 'Pagamento mai arrivato', resto: 'Truffa del resto',
  furto: 'Furto o taccheggio', incaricati: 'Finti incaricati', credito: 'Credito non saldato', altro: 'Altro'
};
export const CC = {
  banconote: '#1f9367', pagamento: '#3577d4', resto: '#d9860a', furto: '#df3a3e',
  incaricati: '#8a5cd6', credito: '#c43f7c', altro: '#6b7c78'
};
export const COLORS = ['#dc4f26', '#11695f', '#3b5bdb', '#9c36b5', '#c2255c', '#2b8a3e', '#e67700', '#495057'];
export const TYPES = ['Alimentari', 'Panetteria', 'Bar', 'Tabaccheria', 'Edicola', 'Ferramenta', 'Abbigliamento', 'Farmacia', 'Parrucchiere', 'Altro'];
export const SERIES_AT = 3;

const sv = d => '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' + d + '</svg>';

export const CI = {
  banconote: sv('<rect x="2.5" y="6" width="19" height="12" rx="2.5"/><circle cx="12" cy="12" r="2.6"/><path d="M6 9.5v5M18 9.5v5"/>'),
  pagamento: sv('<rect x="6" y="2.5" width="12" height="19" rx="3"/><path d="M10 18h4"/><path d="m9.5 10.5 2 2 3.5-4"/>'),
  resto: sv('<ellipse cx="9" cy="7" rx="5.5" ry="2.5"/><path d="M3.5 7v4c0 1.4 2.5 2.5 5.5 2.5s5.5-1.1 5.5-2.5V7"/><path d="M9.5 16.5c.9 1.2 3 2 5.5 2 3 0 5.5-1.1 5.5-2.5v-4c0-1.4-2.5-2.5-5.5-2.5"/>'),
  furto: sv('<path d="M5 8h14l-1.2 12.5H6.2Z"/><path d="M9 8V6.5a3 3 0 0 1 6 0V8"/><path d="m10 13 4 4M14 13l-4 4"/>'),
  incaricati: sv('<rect x="3" y="5" width="18" height="14" rx="2.5"/><circle cx="9" cy="11" r="2.2"/><path d="M5.8 16c.6-1.6 1.8-2.4 3.2-2.4s2.6.8 3.2 2.4M15 10h3.5M15 13.5h2.5"/>'),
  credito: sv('<path d="M6 2.5h12v19l-3-2-3 2-3-2-3 2Z"/><path d="M9.5 8h5M9.5 12h5M9.5 16h3"/>'),
  altro: sv('<circle cx="12" cy="12" r="9"/><path d="M12 7.5v5.5M12 16.5v.1"/>')
};

export const I = {
  logo: '<svg viewBox="0 0 40 40" aria-hidden="true"><rect width="40" height="40" rx="13" fill="var(--brand)"/><path d="M8 17 10.5 9h19l2.5 8Z" fill="var(--accent)"/><path d="M14.5 9 13.8 17M20 9v8M25.5 9l.7 8" stroke="var(--awning-2)" stroke-width="3"/><path d="M8 17a3 3 0 0 0 6 0a3 3 0 0 0 6 0a3 3 0 0 0 6 0a3 3 0 0 0 6 0" fill="var(--accent)"/><rect x="12" y="23" width="16" height="10" rx="2.5" fill="var(--on-brand)" opacity=".92"/><rect x="18.6" y="25" width="2.8" height="4" rx="1.2" fill="var(--accent)"/><circle cx="20" cy="31" r="1.3" fill="var(--accent)"/></svg>',
  home: sv('<path d="M3 10.5 12 4l9 6.5"/><path d="M5 9.5V20h14V9.5"/><path d="M10 20v-5h4v5"/>'),
  chat: sv('<path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12Z"/>'),
  tools: sv('<path d="M12 3 3 7.5l9 4.5 9-4.5L12 3Z"/><path d="m3 12 9 4.5 9-4.5"/><path d="m3 16.5 9 4.5 9-4.5"/>'),
  gear: sv('<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 0 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 0 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 0 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 0 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z"/>'),
  bell: sv('<path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.9 1.9 0 0 0 3.4 0"/>'),
  plus: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>',
  shield: sv('<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z"/>'),
  bolt: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M13 2 4 14h7l-1 8 9-12h-7l1-8Z"/></svg>',
  back: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="m15 18-6-6 6-6"/></svg>'
};

// Blocca dati che identificano una persona: iniziali, nomi, telefoni, targhe, dove abita.
// Lo stesso controllo gira anche sul server (functions/index.js).
export function privacyIssue(txt) {
  const t = ' ' + txt + ' ';
  if (/\b[A-Z]\.\s?[A-Z]\.?(?=\W)/.test(t)) return 'Sembrano esserci delle iniziali (es. “M.R.”).';
  if (/\b(sig\.?|sig\.ra|signor[ae]?|signora)\s+[A-Z]/i.test(t)) return 'Sembra indicato il nome di una persona.';
  if (/\b(nome|cognome|si chiama)\b/i.test(t)) return 'Sembra indicato il nome di una persona.';
  if (/(\+?\d[\s-]?){9,}/.test(t)) return 'Sembra esserci un numero di telefono.';
  if (/\b[A-Z]{2}\s?\d{3}\s?[A-Z]{2}\b/.test(t)) return 'Sembra esserci una targa.';
  if (/\b(abita|vive|residente)\b/i.test(t)) return 'Sembra indicato dove abita una persona.';
  return '';
}
