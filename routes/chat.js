const { getSession, analysisTemplate, llm, sessions } = require('../server');
const { parseAnalysisResponse } = require('./utils');

// Endpoint simplificado para chat continuo
async function handleChat(req, res) {
  try {
    const { question, sessionId } = req.body;

    if (!question || !question.trim()) {
      return res.status(400).json({ error: 'Question es requerida' });
    }

    // Si no hay sessionId, buscar la sesión más reciente activa
    let session;
    if (sessionId) {
      session = getSession(sessionId);
    } else {
      // Buscar sesión más reciente que no haya expirado
      const activeSessions = Array.from(sessions.values())
        .filter(s => Date.now() < s.expiresAt)
        .sort((a, b) => b.createdAt - a.createdAt);
      
      session = activeSessions[0] || null;
    }

    if (!session) {
      return res.status(404).json({ 
        error: 'No hay sesiones activas. Sube un archivo primero.',
        needsUpload: true
      });
    }

    // Agregar pregunta al historial
    session.conversationHistory.push({
      type: 'question',
      content: question,
      timestamp: new Date().toISOString()
    });

    // Preparar contexto para LangChain
    const recentHistory = session.conversationHistory.slice(-6).map(h => 
      `${h.type}: ${h.content}`
    ).join('\n');

    const prompt = await analysisTemplate.format({
      columns: session.columns.join(', '),
      totalRows: session.data.length,
      sampleData: JSON.stringify(session.data.slice(0, 5), null, 2),
      question: question,
      conversationHistory: recentHistory
    });

    // Consultar a OpenAI
    const aiResponse = await llm.invoke(prompt);
    const analysis = parseAnalysisResponse(aiResponse.content, question, session.data);

    // Agregar respuesta al historial
    session.conversationHistory.push({
      type: 'response',
      content: analysis,
      timestamp: new Date().toISOString()
    });

    res.json({
      sessionId: session.id,
      question: question,
      response: analysis,
      expiresAt: new Date(session.expiresAt).toISOString(),
      conversationCount: session.conversationHistory.length
    });

  } catch (error) {
    console.error('Error en chat:', error);
    res.status(500).json({ error: 'Error procesando la pregunta' });
  }
}

module.exports = { handleChat };