module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { audio, mimeType = 'audio/webm', dict = [] } = req.body || {};
  if (!audio) return res.status(400).json({ error: 'audio is required' });

  try {
    // ── Step 1: Whisper で文字起こし ──────────────────────────
    const audioBuffer = Buffer.from(audio, 'base64');
    const blob = new Blob([audioBuffer], { type: mimeType });

    const formData = new FormData();
    formData.append('file', blob, 'recording.webm');
    formData.append('model', 'whisper-1');
    formData.append('language', 'ja');
    // ユーザー辞書の「from」をヒントとして渡す（固有名詞の認識精度向上）
    if (dict.length > 0) {
      formData.append('prompt', dict.map(d => d.from).join('、'));
    }

    const whisperRes = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${process.env.OPENAI_API_KEY}` },
      body: formData,
    });

    if (!whisperRes.ok) {
      const errText = await whisperRes.text();
      console.error('Whisper error:', whisperRes.status, errText);
      return res.status(502).json({ error: 'transcription failed' });
    }

    const { text: transcript } = await whisperRes.json();
    if (!transcript?.trim()) return res.json({ transcript: '', corrected: '' });

    // ── Step 2: GPT-4o-mini で補正 ────────────────────────────
    const dictHint = dict.length > 0
      ? '\n変換辞書（必ず優先して適用すること）:\n' + dict.map(d => `  ${d.from} → ${d.to}`).join('\n')
      : '';

    const gptRes = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [
          {
            role: 'system',
            content: `あなたはタスク管理アプリの音声入力補正AIです。
音声認識されたテキストを、タスク文として自然な日本語に整えてください。${dictHint}

ルール：
- 辞書に登録された変換を必ず適用する
- 誤字・誤変換を文脈で補正する（例：変身待ち→返信待ち）
- タスクの意味・内容は変えない
- 補正後のテキストのみを返す（説明・コメントは不要）
- 短く、タスクとして自然な表現にする`,
          },
          { role: 'user', content: transcript },
        ],
        max_tokens: 100,
        temperature: 0.1,
      }),
    });

    if (!gptRes.ok) {
      // GPT 失敗時は Whisper 結果をそのまま返す
      return res.json({ transcript, corrected: transcript });
    }

    const gptData = await gptRes.json();
    const corrected = gptData.choices?.[0]?.message?.content?.trim() ?? transcript;
    return res.json({ transcript, corrected });

  } catch (e) {
    console.error('transcribe handler error:', e);
    return res.status(500).json({ error: e.message });
  }
};
