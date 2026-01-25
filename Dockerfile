FROM node:20-alpine

WORKDIR /app

# Instalar dependencias del sistema para sqlite3 (compilación nativa)
RUN apk add --no-cache python3 make g++

# Copiar archivos de dependencias
COPY package.json package-lock.json* ./

# Instalar dependencias
RUN npm install

# Copiar código fuente
COPY . .

# Crear directorios necesarios
RUN mkdir -p /app/data /app/resumes

# Exponer puerto
EXPOSE 3000

# Comando para iniciar el servidor
CMD ["npm", "start"]
