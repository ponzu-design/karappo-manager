module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { text, dict } = req.body || {};
  if (!text) return res.status(400).json({ error: 'text is required' });

  const dictHint = Array.isArray(dict) && dict.length > 0
    ? '\n変換辞書（必ず優先して適用すること）:\n' + dict.map(d => `  ${d.from} → ${d.to}`).join('\n')
    : '';

  try {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
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
- 音声認識の誤字・誤変換を文脈で補正する（例：変身待ち→返信待ち、確認まち→確認待ち）
- 辞書に登録された変換を必ず適用する
- タスクの意味・内容は変えない
- 補正後のテキストのみを返す（説明・コメントは不要）
- 短く、タスクとして自然な表現にする`,
          },
          { role: 'user', content: text },
        ],
        max_tokens: 100,
        temperature: 0.1,
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error('OpenAI error:', response.status, errText);
      return res.status(502).json({ corrected: text, error: 'upstream error' });
    }

    const data = await response.json();
    const corrected = data.choices?.[0]?.message?.content?.trim() ?? text;
    return res.json({ corrected });

  } catch (e) {
    console.error('handler error:', e);
    return res.status(500).json({ corrected: text, error: e.message });
  }
};
