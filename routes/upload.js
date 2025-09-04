const { createSession, analysisTemplate, llm } = require('../server');
const { parseAnalysisResponse } = require('./utils');

// Endpoint mejorado: subir archivo + pregunta opcional
async function handleUpload(req, res) {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No se subió ningún archivo' });
    }

    // Leer archivo Excel/CSV
    const xlsx = require('xlsx');
    const workbook = xlsx.read(req.file.buffer, { type: 'buffer' });
    const sheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[sheetName];
    const data = xlsx.utils.sheet_to_json(worksheet);

    // Crear nueva sesión con los datos
    const columns = data.length > 0 ? Object.keys(data[0]) : [];
    const session = createSession(data, columns);

    // Verificar si viene una pregunta inicial
    const { question } = req.body;
    let initialResponse = null;

    if (question && question.trim()) {
      try {
        // Procesar pregunta inicial
        session.conversationHistory.push({
          type: 'question',
          content: question,
          timestamp: new Date().toISOString()
        });

        const prompt = await analysisTemplate.format({
          columns: session.columns.join(', '),
          totalRows: session.data.length,
          sampleData: JSON.stringify(session.data.slice(0, 3), null, 2),
          question: question,
          conversationHistory: ''
        });

        const aiResponse = await llm.invoke(prompt);
        const analysis = parseAnalysisResponse(aiResponse.content, question, session.data);

        session.conversationHistory.push({
          type: 'response',
          content: analysis,
          timestamp: new Date().toISOString()
        });

        initialResponse = analysis;
      } catch (error) {
        console.error('Error procesando pregunta inicial:', error);
      }
    }

    // Respuesta completa
    res.json({
      message: 'Archivo procesado exitosamente',
      sessionId: session.id,
      totalRows: data.length,
      columns: columns,
      sampleData: data.slice(0, 3),
      expiresAt: new Date(session.expiresAt).toISOString(),
      validFor: '2 días',
      ...(initialResponse && {
        initialQuestion: question,
        initialResponse: initialResponse
      })
    });

  } catch (error) {
    console.error('Error procesando archivo:', error);
    res.status(500).json({ error: 'Error procesando el archivo' });
  }
}

module.exports = { handleUpload };