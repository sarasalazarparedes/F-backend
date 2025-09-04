const { getSession, llm } = require('../server');
const { generateComprehensiveAnalysis } = require('./utils');
const { Document, Packer, Paragraph, TextRun, HeadingLevel, Table, TableRow, TableCell, WidthType, AlignmentType, ImageRun } = require('docx');
const { PromptTemplate } = require('@langchain/core/prompts');

// Configurar Chart.js (opcional - solo si está instalado)
let chartJSNodeCanvas = null;
try {
  const { ChartJSNodeCanvas } = require('chartjs-node-canvas');
  const width = 800;
  const height = 600;
  chartJSNodeCanvas = new ChartJSNodeCanvas({ width, height, backgroundColour: 'white' });
  console.log('✅ Chart generation enabled');
} catch (error) {
  console.log('⚠️  Chart generation disabled - install chartjs-node-canvas for charts');
}

// Template para generar reportes estratégicos completos
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

// Función para generar gráfica como imagen (solo si chartjs-node-canvas está disponible)
async function generateChartImage(chartData) {
  if (!chartJSNodeCanvas || !chartData) return null;

  const configuration = {
    type: chartData.type === 'pie' ? 'pie' : 'bar',
    data: {
      labels: chartData.labels,
      datasets: [{
        label: chartData.title,
        data: chartData.data,
        backgroundColor: [
          'rgba(54, 162, 235, 0.8)',
          'rgba(255, 99, 132, 0.8)',
          'rgba(255, 206, 86, 0.8)',
          'rgba(75, 192, 192, 0.8)',
          'rgba(153, 102, 255, 0.8)',
          'rgba(255, 159, 64, 0.8)',
          'rgba(199, 199, 199, 0.8)'
        ],
        borderColor: [
          'rgba(54, 162, 235, 1)',
          'rgba(255, 99, 132, 1)',
          'rgba(255, 206, 86, 1)',
          'rgba(75, 192, 192, 1)',
          'rgba(153, 102, 255, 1)',
          'rgba(255, 159, 64, 1)',
          'rgba(199, 199, 199, 1)'
        ],
        borderWidth: 1
      }]
    },
    options: {
      responsive: false,
      plugins: {
        title: {
          display: true,
          text: chartData.title,
          font: { size: 16 }
        },
        legend: {
          display: true,
          position: 'bottom'
        }
      }
    }
  };

  try {
    const imageBuffer = await chartJSNodeCanvas.renderToBuffer(configuration);
    return imageBuffer;
  } catch (error) {
    console.error('Error generating chart:', error);
    return null;
  }
}

// Endpoint para generar reporte en Word
async function handleGenerateReportWord(req, res) {
  try {
    const { sessionId } = req.body;
    const session = getSession(sessionId);
    
    if (!session) {
      return res.status(404).json({ error: 'Sesión no encontrada' });
    }

    console.log('Generando análisis completo...');
    
    // Generar análisis completo de los datos
    const comprehensiveAnalysis = generateComprehensiveAnalysis(session.data);
    
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
    
    // Generar gráficas principales
    console.log('Generando gráficas...');
    const charts = [];
    const distributionKeys = Object.keys(comprehensiveAnalysis.distributions);
    
    for (let i = 0; i < Math.min(3, distributionKeys.length); i++) {
      const column = distributionKeys[i];
      const distribution = comprehensiveAnalysis.distributions[column];
      
      const chartData = {
        type: Object.keys(distribution).length <= 5 ? 'pie' : 'bar',
        labels: Object.keys(distribution),
        data: Object.values(distribution),
        title: `Distribución por ${column}`
      };
      
      const imageBuffer = await generateChartImage(chartData);
      if (imageBuffer) {
        charts.push({
          title: chartData.title,
          image: imageBuffer
        });
      }
    }

    console.log(`Generadas ${charts.length} gráficas`);

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

            // Sección de gráficas (solo si hay gráficas disponibles)
            ...(charts.length > 0 ? [
              new Paragraph({
                children: [
                  new TextRun({
                    text: "ANÁLISIS VISUAL",
                    bold: true,
                    size: 24,
                    color: "2E86AB"
                  }),
                ],
                spacing: { before: 600, after: 300 }
              }),

              // Insertar gráficas
              ...charts.map(chart => [
                new Paragraph({
                  children: [
                    new TextRun({
                      text: chart.title,
                      bold: true,
                      size: 20
                    }),
                  ],
                  spacing: { before: 300, after: 200 }
                }),
                new Paragraph({
                  children: [
                    new ImageRun({
                      data: chart.image,
                      transformation: {
                        width: 600,
                        height: 400,
                      },
                    }),
                  ],
                  alignment: AlignmentType.CENTER,
                  spacing: { after: 400 }
                })
              ]).flat()
            ] : [
              // Mensaje alternativo si no hay gráficas
              new Paragraph({
                children: [
                  new TextRun({
                    text: "DISTRIBUCIONES DE DATOS",
                    bold: true,
                    size: 24,
                    color: "2E86AB"
                  }),
                ],
                spacing: { before: 600, after: 300 }
              }),
              new Paragraph({
                children: [
                  new TextRun({
                    text: "Las distribuciones de datos se han analizado y están incluidas en el análisis estratégico anterior.",
                    size: 20,
                    italics: true
                  }),
                ],
                spacing: { after: 400 }
              })
            ]),

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
}

module.exports = { handleGenerateReportWord };