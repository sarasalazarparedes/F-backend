const express = require('express');
const cors = require('cors');
const multer = require('multer');
const xlsx = require('xlsx');
const { ChatOpenAI } = require('@langchain/openai');
const { PromptTemplate } = require('@langchain/core/prompts');
require('dotenv').config();

const app = express();
const port = process.env.PORT || 3002;

// Middleware
app.use(cors());
app.use(express.json());

// Storage para archivos subidos
const upload = multer({ storage: multer.memoryStorage() });

// Sistema de sesiones temporales (2 días)
const sessions = new Map();
const SESSION_DURATION = 2 * 24 * 60 * 60 * 1000;

// Configurar OpenAI
const llm = new ChatOpenAI({
  openAIApiKey: process.env.OPENAI_API_KEY,
  modelName: "gpt-4",
  temperature: 0.1,
});

// Template INTELIGENTE y GENÉRICO para análisis
const analysisTemplate = new PromptTemplate({
  template: `Eres un analista financiero experto. Analiza los datos y responde SIEMPRE en español.

DATOS DISPONIBLES:
Total de registros: {totalRows}
Columnas disponibles: {columns}
Muestra de los datos reales: {sampleData}

HISTORIAL RECIENTE: {conversationHistory}

PREGUNTA: {question}

INSTRUCCIONES:
1. SIEMPRE responde en ESPAÑOL COMPLETO
2. Analiza los datos reales que te proporciono en la muestra
3. Identifica automáticamente qué representan las columnas basándote en sus nombres y valores
4. Para preguntas sobre métricas específicas, CALCULA usando los patrones de los datos
5. Si detectas que son datos financieros, aplica contexto financiero apropiado
6. Si necesitas hacer cálculos, estímalos basándote en los patrones que ves en la muestra

GUÍAS GENERALES (adapta según los datos que veas):
- Si ves columnas como "estado", "calificacion", "status": analiza cuáles son positivos/negativos
- Si ves montos o importes: suma, promedia o compara según la pregunta
- Si ves fechas: analiza tendencias temporales
- Si ves categorías (agencias, productos, tipos): compara desempeños
- Si ves indicadores de riesgo: identifica los más/menos riesgosos

FORMATO DE RESPUESTA:
Da una respuesta directa, específica y en español. Si puedes estimar números basándote en los datos de muestra y extrapolar al total, hazlo.

Ejemplo de análisis inteligente:
"Basándome en la muestra de {totalRows} registros, veo que la columna 'calificacion' tiene valores como VIGENTE, VENCIDO, etc. Analizando los patrones..."

Responde inteligentemente:`,
  inputVariables: ["columns", "totalRows", "sampleData", "question", "conversationHistory"],
});

// Funciones auxiliares para sesiones
function generateSessionId() {
  return Math.random().toString(36).substring(2) + Date.now().toString(36);
}

function getSession(sessionId) {
  if (!sessionId || !sessions.has(sessionId)) return null;
  const session = sessions.get(sessionId);
  if (Date.now() > session.expiresAt) {
    sessions.delete(sessionId);
    return null;
  }
  return session;
}

function createSession(data, columns) {
  const sessionId = generateSessionId();
  const session = {
    id: sessionId,
    data: data,
    columns: columns,
    createdAt: Date.now(),
    expiresAt: Date.now() + SESSION_DURATION,
    conversationHistory: []
  };
  sessions.set(sessionId, session);
  return session;
}

// Función GENÉRICA para parsear respuesta (SIN OVERFIT)
function parseAnalysisResponse(aiResponse, question, sessionData) {
  const needsChart = question.toLowerCase().includes('gráfica') || 
                    question.toLowerCase().includes('gráfico') ||
                    question.toLowerCase().includes('distribución') ||
                    question.toLowerCase().includes('muestra') ||
                    question.toLowerCase().includes('comparar');

  // Calcular métricas básicas DINÁMICAMENTE
  let calculations = {};
  if (sessionData && sessionData.length > 0) {
    calculations.totalRegistros = sessionData.length;
    
    // Detectar automáticamente columnas numéricas y sumarlas
    const firstRow = sessionData[0];
    Object.keys(firstRow).forEach(column => {
      const values = sessionData
        .map(row => row[column])
        .filter(val => val !== null && val !== undefined && !isNaN(val));
      
      if (values.length > 0) {
        const total = values.reduce((sum, val) => sum + parseFloat(val), 0);
        const avg = total / values.length;
        
        // Guardar solo si parece relevante (no IDs o fechas)
        if (!column.toLowerCase().includes('id') && 
            !column.toLowerCase().includes('numero') &&
            avg > 0) {
          calculations[`total_${column}`] = total;
          calculations[`promedio_${column}`] = avg;
        }
      }
    });

    // Detectar automáticamente columnas categóricas para distribuciones
    Object.keys(firstRow).forEach(column => {
      const uniqueValues = [...new Set(sessionData.map(row => row[column]))];
      
      // Si tiene pocas categorías únicas, crear distribución
      if (uniqueValues.length > 1 && uniqueValues.length < 20) {
        const distribution = {};
        sessionData.forEach(row => {
          const value = row[column] || 'Sin clasificar';
          distribution[value] = (distribution[value] || 0) + 1;
        });
        calculations[`distribucion_${column}`] = distribution;
      }
    });
  }

  return {
    type: needsChart ? 'grafica' : 'metrica',
    aiResponse: aiResponse, // IA es inteligente, usar su respuesta directamente
    calculations: calculations,
    chartData: needsChart ? generateChartDataDynamic(question, sessionData) : null
  };
}

// Generar gráficas DINÁMICAMENTE según los datos
function generateChartDataDynamic(question, sessionData) {
  if (!sessionData || sessionData.length === 0) return null;

  // Detectar automáticamente qué columna usar para la gráfica
  const firstRow = sessionData[0];
  const columns = Object.keys(firstRow);
  
  // Buscar columnas categóricas mencionadas en la pregunta
  const questionLower = question.toLowerCase();
  
  for (const column of columns) {
    if (questionLower.includes(column.toLowerCase())) {
      const uniqueValues = [...new Set(sessionData.map(row => row[column]))];
      
      // Si es categórica (pocas valores únicos)
      if (uniqueValues.length > 1 && uniqueValues.length < 15) {
        const distribution = {};
        sessionData.forEach(row => {
          const value = row[column] || 'Sin clasificar';
          distribution[value] = (distribution[value] || 0) + 1;
        });

        return {
          type: uniqueValues.length <= 5 ? 'pie' : 'bar',
          labels: Object.keys(distribution),
          data: Object.values(distribution),
          title: `Distribución por ${column}`
        };
      }
    }
  }

  // Si no encuentra nada específico, usar la primera columna categórica
  for (const column of columns) {
    const uniqueValues = [...new Set(sessionData.map(row => row[column]))];
    
    if (uniqueValues.length > 1 && uniqueValues.length < 10) {
      const distribution = {};
      sessionData.forEach(row => {
        const value = row[column] || 'Sin clasificar';
        distribution[value] = (distribution[value] || 0) + 1;
      });

      return {
        type: 'bar',
        labels: Object.keys(distribution),
        data: Object.values(distribution),
        title: `Distribución por ${column}`
      };
    }
  }

  return null;
}

// Función para analizar todos los datos y generar métricas completas
function generateComprehensiveAnalysis(sessionData) {
  if (!sessionData || sessionData.length === 0) return {};

  const analysis = {
    totalRecords: sessionData.length,
    columns: [],
    metrics: {},
    distributions: {}
  };

  const firstRow = sessionData[0];
  const columns = Object.keys(firstRow);

  columns.forEach(column => {
    const values = sessionData.map(row => row[column]).filter(val => val !== null && val !== undefined);
    const uniqueValues = [...new Set(values)];

    analysis.columns.push({
      name: column,
      type: typeof firstRow[column],
      uniqueCount: uniqueValues.length,
      sampleValues: uniqueValues.slice(0, 3)
    });

    // Métricas numéricas
    const numericValues = values.filter(val => !isNaN(val) && val !== '').map(val => parseFloat(val));
    if (numericValues.length > 0) {
      analysis.metrics[column] = {
        count: numericValues.length,
        sum: numericValues.reduce((a, b) => a + b, 0),
        average: numericValues.reduce((a, b) => a + b, 0) / numericValues.length,
        min: Math.min(...numericValues),
        max: Math.max(...numericValues)
      };
    }

    // Distribuciones categóricas
    if (uniqueValues.length > 1 && uniqueValues.length < 50) {
      const distribution = {};
      values.forEach(value => {
        const key = value || 'Sin clasificar';
        distribution[key] = (distribution[key] || 0) + 1;
      });
      analysis.distributions[column] = distribution;
    }
  });

  return analysis;
}

// ENDPOINTS INLINE (sin circular dependencies)

// Endpoint para subir archivo
app.post('/api/upload', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No se subió ningún archivo' });
    }

    // Leer archivo Excel/CSV
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
});

// Endpoint para chat
app.post('/api/chat', async (req, res) => {
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
});

// Endpoint para generar reporte Word con todo inline
app.post('/api/generate-report-word', async (req, res) => {
  try {
    const { sessionId } = req.body;
    const session = getSession(sessionId);
    
    if (!session) {
      return res.status(404).json({ error: 'Sesión no encontrada' });
    }

    console.log('Generando análisis completo...');
    
    // Generar análisis completo de los datos
    const comprehensiveAnalysis = generateComprehensiveAnalysis(session.data);
    
    // Template para reportes
    const reportTemplate = new PromptTemplate({
      template: `Eres un consultor estratégico senior. Genera un INFORME ESTRATÉGICO COMPLETO basado en los datos analizados.

CONTEXTO DE LOS DATOS:
- Total de registros: {totalRows}
- Columnas disponibles: {columns}
- Muestra representativa: {sampleData}
- Análisis de distribuciones: {distributions}
- Métricas calculadas: {metrics}

INSTRUCCIONES PARA EL INFORME:
1. Analiza PROFUNDAMENTE los datos reales proporcionados
2. Identifica el tipo de negocio/industria basándote en las columnas
3. Genera insights estratégicos específicos y accionables
4. Incluye números reales extrapolados de la muestra
5. Todo en español profesional

ESTRUCTURA REQUERIDA:

**RESUMEN EJECUTIVO**
[Párrafo de 3-4 líneas con los hallazgos más importantes y el contexto del negocio]

**ANÁLISIS DE DATOS CLAVE**
[Analiza las métricas más importantes que calculaste, con números específicos]

**DISTRIBUCIONES CRÍTICAS**
[Examina las distribuciones categóricas más relevantes para el negocio]

**FORTALEZAS IDENTIFICADAS**
• [Fortaleza específica basada en datos reales]
• [Segunda fortaleza con números de soporte]
• [Tercera fortaleza]

**RIESGOS Y ÁREAS CRÍTICAS**
• [Riesgo específico identificado en los datos]
• [Segundo riesgo con impacto cuantificado]
• [Tercer riesgo]

**OPORTUNIDADES DE MEJORA**
• [Oportunidad específica]
• [Segunda oportunidad con potencial de impacto]
• [Tercera oportunidad]

**RECOMENDACIONES ESTRATÉGICAS**
1. **Acción Prioritaria:** [Recomendación específica y accionable]
2. **Optimización Operativa:** [Segunda recomendación]
3. **Gestión de Riesgos:** [Tercera recomendación]
4. **Monitoreo Continuo:** [Cuarta recomendación]

**MÉTRICAS CLAVE A MONITOREAR**
• [Métrica 1]: [Valor actual] - [Objetivo sugerido]
• [Métrica 2]: [Valor actual] - [Objetivo sugerido]
• [Métrica 3]: [Valor actual] - [Objetivo sugerido]

Genera el informe completo y profesional:`,
      inputVariables: ["totalRows", "columns", "sampleData", "distributions", "metrics"],
    });
    
    // Generar el reporte con IA
    const reportPrompt = await reportTemplate.format({
      totalRows: comprehensiveAnalysis.totalRecords,
      columns: session.columns.join(', '),
      sampleData: JSON.stringify(session.data.slice(0, 3), null, 2),
      distributions: JSON.stringify(comprehensiveAnalysis.distributions, null, 2),
      metrics: JSON.stringify(comprehensiveAnalysis.metrics, null, 2)
    });

    console.log('Llamando a OpenAI para generar reporte...');
    const reportResponse = await llm.invoke(reportPrompt);
    
    // Importar docx aquí para evitar problemas
    const { Document, Packer, Paragraph, TextRun, HeadingLevel, Table, TableRow, TableCell, WidthType, AlignmentType } = require('docx');

    // Crear documento Word
    const doc = new Document({
      creator: "Excel AI Analyst",
      title: "Informe Estratégico",
      description: "Análisis estratégico generado por IA",
      sections: [
        {
          properties: {},
          children: [
            // Título principal
            new Paragraph({
              children: [
                new TextRun({
                  text: "INFORME ESTRATÉGICO",
                  bold: true,
                  size: 32,
                  color: "2E86AB"
                }),
              ],
              heading: HeadingLevel.TITLE,
              alignment: AlignmentType.CENTER,
              spacing: { after: 400 }
            }),

            // Información del documento
            new Paragraph({
              children: [
                new TextRun({
                  text: `Generado el: ${new Date().toLocaleDateString('es-ES')}`,
                  italics: true,
                  size: 20
                }),
              ],
              alignment: AlignmentType.CENTER,
              spacing: { after: 600 }
            }),

            // Contenido del reporte generado por IA
            ...reportResponse.content.split('\n').map(line => {
              if (line.startsWith('**') && line.endsWith('**')) {
                // Es un título
                return new Paragraph({
                  children: [
                    new TextRun({
                      text: line.replace(/\*\*/g, ''),
                      bold: true,
                      size: 24,
                      color: "2E86AB"
                    }),
                  ],
                  spacing: { before: 400, after: 200 }
                });
              } else if (line.startsWith('•') || line.startsWith('1.') || line.startsWith('2.') || line.startsWith('3.') || line.startsWith('4.')) {
                // Es una lista
                return new Paragraph({
                  children: [
                    new TextRun({
                      text: line,
                      size: 22
                    }),
                  ],
                  spacing: { after: 100 },
                  indent: { left: 360 }
                });
              } else if (line.trim().length > 0) {
                // Es texto normal
                return new Paragraph({
                  children: [
                    new TextRun({
                      text: line,
                      size: 22
                    }),
                  ],
                  spacing: { after: 200 }
                });
              } else {
                // Es una línea vacía
                return new Paragraph({
                  children: [new TextRun({ text: "", size: 22 })],
                  spacing: { after: 100 }
                });
              }
            }),

            // Tabla resumen de métricas clave
            new Paragraph({
              children: [
                new TextRun({
                  text: "RESUMEN DE MÉTRICAS CLAVE",
                  bold: true,
                  size: 24,
                  color: "2E86AB"
                }),
              ],
              spacing: { before: 600, after: 300 }
            }),

            // Crear tabla con las métricas más importantes
            new Table({
              rows: [
                // Header de la tabla
                new TableRow({
                  children: [
                    new TableCell({
                      children: [new Paragraph({
                        children: [new TextRun({ text: "Métrica", bold: true, color: "FFFFFF" })],
                        alignment: AlignmentType.CENTER
                      })],
                      shading: { fill: "2E86AB" }
                    }),
                    new TableCell({
                      children: [new Paragraph({
                        children: [new TextRun({ text: "Valor", bold: true, color: "FFFFFF" })],
                        alignment: AlignmentType.CENTER
                      })],
                      shading: { fill: "2E86AB" }
                    }),
                    new TableCell({
                      children: [new Paragraph({
                        children: [new TextRun({ text: "Descripción", bold: true, color: "FFFFFF" })],
                        alignment: AlignmentType.CENTER
                      })],
                      shading: { fill: "2E86AB" }
                    })
                  ],
                }),
                // Filas de datos
                new TableRow({
                  children: [
                    new TableCell({
                      children: [new Paragraph({ children: [new TextRun({ text: "Total de Registros" })] })]
                    }),
                    new TableCell({
                      children: [new Paragraph({ 
                        children: [new TextRun({ text: comprehensiveAnalysis.totalRecords.toLocaleString() })],
                        alignment: AlignmentType.CENTER
                      })]
                    }),
                    new TableCell({
                      children: [new Paragraph({ children: [new TextRun({ text: "Número total de registros analizados" })] })]
                    })
                  ],
                }),
                // Agregar métricas numéricas dinámicamente
                ...Object.entries(comprehensiveAnalysis.metrics).slice(0, 5).map(([column, metrics]) => 
                  new TableRow({
                    children: [
                      new TableCell({
                        children: [new Paragraph({ children: [new TextRun({ text: column })] })]
                      }),
                      new TableCell({
                        children: [new Paragraph({ 
                          children: [new TextRun({ text: metrics.average.toLocaleString('es-ES', { maximumFractionDigits: 2 }) })],
                          alignment: AlignmentType.CENTER
                        })]
                      }),
                      new TableCell({
                        children: [new Paragraph({ children: [new TextRun({ text: `Promedio de ${column}` })] })]
                      })
                    ],
                  })
                )
              ],
              width: {
                size: 100,
                type: WidthType.PERCENTAGE,
              },
            }),

            // Pie de página
            new Paragraph({
              children: [
                new TextRun({
                  text: "---",
                  size: 20
                }),
              ],
              alignment: AlignmentType.CENTER,
              spacing: { before: 800, after: 200 }
            }),

            new Paragraph({
              children: [
                new TextRun({
                  text: "Este informe ha sido generado automáticamente por Excel AI Analyst utilizando análisis de datos avanzado e inteligencia artificial.",
                  italics: true,
                  size: 18,
                  color: "666666"
                }),
              ],
              alignment: AlignmentType.CENTER,
              spacing: { after: 200 }
            }),

            new Paragraph({
              children: [
                new TextRun({
                  text: `Fecha de generación: ${new Date().toLocaleDateString('es-ES', { 
                    year: 'numeric', 
                    month: 'long', 
                    day: 'numeric',
                    hour: '2-digit',
                    minute: '2-digit'
                  })}`,
                  size: 16,
                  color: "999999"
                }),
              ],
              alignment: AlignmentType.CENTER
            }),
          ],
        },
      ],
    });

    console.log('Generando documento Word...');
    
    // Generar el archivo Word
    const buffer = await Packer.toBuffer(doc);
    
    // Configurar headers para descarga
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    res.setHeader('Content-Disposition', `attachment; filename="Informe_Estrategico_${new Date().toISOString().split('T')[0]}.docx"`);
    res.setHeader('Content-Length', buffer.length);
    
    console.log('Enviando documento Word...');
    res.send(buffer);

  } catch (error) {
    console.error('Error generando reporte Word:', error);
    res.status(500).json({ 
      error: 'Error generando el reporte en Word',
      details: error.message 
    });
  }
});

// Endpoint simplificado para reportes JSON (mantener compatibilidad)
app.post('/api/generate-report', async (req, res) => {
  try {
    const { sessionId } = req.body;
    const session = getSession(sessionId);
    
    if (!session) {
      return res.status(404).json({ error: 'Sesión no encontrada' });
    }

    const basicStats = {
      totalRecords: session.data.length,
      columns: session.columns.length,
      sampleData: session.data.slice(0, 2)
    };

    const reportPrompt = `Analiza estos datos y genera un INFORME ESTRATÉGICO en español:

DATOS BÁSICOS:
- Total de registros: ${basicStats.totalRecords}
- Columnas disponibles: ${session.columns.join(', ')}
- Tipo de datos: ${JSON.stringify(basicStats.sampleData)}

INSTRUCCIONES:
1. Genera un resumen ejecutivo profesional
2. Identifica 2 puntos fuertes principales
3. Identifica 2 áreas críticas o riesgos
4. Proporciona 3 recomendaciones específicas
5. Todo en español, formato profesional

FORMATO:
📋 **INFORME ESTRATÉGICO**

**Resumen Ejecutivo:**
[Tu análisis aquí]

**Puntos Fuertes:**
• [Punto 1]
• [Punto 2]

**Áreas Críticas:**
• [Riesgo 1]
• [Riesgo 2]

**Recomendaciones:**
1. [Acción prioritaria]
2. [Segunda acción]
3. [Tercera acción]

Genera el informe:`;

    const reportResponse = await llm.invoke(reportPrompt);

    res.json({
      sessionId: sessionId,
      reportData: reportResponse.content,
      generatedAt: new Date().toISOString(),
      expiresAt: new Date(session.expiresAt).toISOString()
    });

  } catch (error) {
    console.error('Error generando reporte:', error);
    res.status(500).json({ 
      error: 'Error generando el reporte',
      details: error.message 
    });
  }
});

// Limpiar sesiones cada hora
setInterval(() => {
  const now = Date.now();
  for (const [sessionId, session] of sessions.entries()) {
    if (now > session.expiresAt) {
      sessions.delete(sessionId);
    }
  }
}, 60 * 60 * 1000);

// Iniciar servidor
app.listen(port, () => {
  console.log(`🚀 Backend ejecutándose en http://localhost:${port}`);
  console.log('✅ IA INTELIGENTE activada con generación de reportes Word');
  console.log('💬 Chat en español con cálculos automáticos');
  console.log('📄 Generación de reportes profesionales');
});