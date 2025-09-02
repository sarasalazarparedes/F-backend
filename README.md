# Excel AI Backend

Backend para Excel AI Analyst - Análisis inteligente de datos con IA y generación de reportes en Word.

## Características

- **Análisis inteligente de datos** con OpenAI GPT-4
- **Generación de reportes profesionales** en formato Word
- **Chat interactivo** para consultar datos
- **Soporte para Excel y CSV**
- **Análisis automático** de distribuciones y métricas
- **Sesiones temporales** (2 días de duración)

## Tecnologías

- Node.js + Express
- LangChain + OpenAI
- Multer (subida de archivos)
- XLSX (procesamiento de Excel)
- docx (generación de documentos Word)

## Instalación Local

```bash
# Clonar repositorio
git clone https://github.com/sarasalazarparedes/F-backend.git
cd F-backend

# Instalar dependencias
npm install

# Configurar variables de entorno
cp .env.example .env
# Editar .env con tu OPENAI_API_KEY

# Ejecutar en desarrollo
npm run dev

# O en producción
npm start
```

## Variables de Entorno

```env
OPENAI_API_KEY=tu_api_key_de_openai
PORT=3002
NODE_ENV=production
```

## API Endpoints

### POST /api/upload
Sube un archivo Excel/CSV y opcionalmente hace una pregunta inicial.

### POST /api/chat
Hace preguntas sobre los datos subidos.

### POST /api/generate-report-word
Genera un reporte estratégico profesional en formato Word.

## Deployment

### Render.com
1. Conectar repositorio de GitHub
2. Configurar build command: `npm install`
3. Configurar start command: `npm start`
4. Agregar variable de entorno `OPENAI_API_KEY`

### Railway.app
1. Conectar GitHub repo
2. Agregar variables de entorno
3. Deploy automático

## Estructura del Proyecto

```
/
├── server.js          # Servidor principal con todos los endpoints
├── package.json       # Dependencias y scripts
├── .env.example       # Plantilla de variables de entorno
├── .gitignore        # Archivos a ignorar en Git
├── render.yaml       # Configuración para Render.com
└── README.md         # Este archivo
```

## Limitaciones del Tier Gratuito

- **Render.com**: Apps duermen tras 15min de inactividad
- **Railway**: $5 crédito mensual
- **Costos OpenAI**: ~$0.01-0.05 por conversación, ~$0.10-0.20 por reporte

## Soporte

Para problemas o preguntas, crear un issue en GitHub.

## Licencia

MIT