// routes/utils.js

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

module.exports = { 
  parseAnalysisResponse, 
  generateChartDataDynamic, 
  generateComprehensiveAnalysis 
};