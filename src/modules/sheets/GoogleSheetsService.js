import { google } from 'googleapis';
import dotenv from 'dotenv';
import path from 'path';
import { existsSync } from 'fs';

// Cargar .env: en Docker está montado en /app/.env; localmente en .env
const envPath = existsSync('/app/.env') ? '/app/.env' : path.resolve(process.cwd(), '.env');
dotenv.config({ path: envPath });

class GoogleSheetsService {
  constructor() {
    this.sheets = null;
    // Soporta ambos formatos: GS_* (del proyecto anterior) y GOOGLE_* (nuevo)
    this.spreadsheetId = process.env.GS_SPREADSHEET_ID || process.env.GOOGLE_SPREADSHEET_ID;
    this.initialized = false;
  }

  async initialize() {
    if (this.initialized) {
      return;
    }

    try {
      // Autenticación usando Service Account
      // Soporta ambos formatos: GS_* (del proyecto anterior) y GOOGLE_* (nuevo)
      const clientEmail = process.env.GS_CLIENT_EMAIL || process.env.GOOGLE_CLIENT_EMAIL;
      const privateKey = (process.env.GS_PRIVATE_KEY || process.env.GOOGLE_PRIVATE_KEY)?.replace(/\\n/g, '\n');

      if (!clientEmail || !privateKey) {
        throw new Error('Faltan credenciales de Google Sheets. Configura GS_CLIENT_EMAIL y GS_PRIVATE_KEY (o GOOGLE_CLIENT_EMAIL y GOOGLE_PRIVATE_KEY)');
      }

      const auth = new google.auth.GoogleAuth({
        credentials: {
          client_email: clientEmail,
          private_key: privateKey,
        },
        scopes: ['https://www.googleapis.com/auth/spreadsheets'],
      });

      const authClient = await auth.getClient();
      this.sheets = google.sheets({ version: 'v4', auth: authClient });
      this.initialized = true;
      
      console.log('✅ Google Sheets Service inicializado');
    } catch (error) {
      console.error('❌ Error inicializando Google Sheets Service:', error);
      throw error;
    }
  }

  /**
   * Leer datos de un rango
   * @param {string} range - Rango en formato "SheetName!A1:B10" o "SheetName!A:B"
   * @returns {Promise<Array>} Array de filas
   */
  async readSheet(range) {
    if (!this.initialized) {
      await this.initialize();
    }

    if (!this.spreadsheetId) {
      throw new Error('GS_SPREADSHEET_ID o GOOGLE_SPREADSHEET_ID no está configurado en .env');
    }

    try {
      const response = await this.sheets.spreadsheets.values.get({
        spreadsheetId: this.spreadsheetId,
        range: range,
      });

      return response.data.values || [];
    } catch (error) {
      console.error('❌ Error leyendo sheet:', error);
      throw error;
    }
  }

  /**
   * Actualizar una celda específica
   * @param {string} range - Rango en formato "SheetName!A1" o "SheetName!E2"
   * @param {any} value - Valor a escribir
   */
  async updateCell(range, value) {
    if (!this.initialized) {
      await this.initialize();
    }

    if (!this.spreadsheetId) {
      throw new Error('GS_SPREADSHEET_ID o GOOGLE_SPREADSHEET_ID no está configurado en .env');
    }

    try {
      await this.sheets.spreadsheets.values.update({
        spreadsheetId: this.spreadsheetId,
        range: range,
        valueInputOption: 'RAW',
        resource: {
          values: [[value]],
        },
      });

      console.log(`✅ Celda ${range} actualizada con valor: ${value}`);
    } catch (error) {
      console.error('❌ Error actualizando celda:', error);
      throw error;
    }
  }

  /**
   * Escribir datos en un rango
   * @param {string} range - Rango en formato "SheetName!A1:D3"
   * @param {Array<Array>} values - Array de filas (cada fila es un array)
   */
  async writeSheet(range, values) {
    if (!this.initialized) {
      await this.initialize();
    }

    if (!this.spreadsheetId) {
      throw new Error('GS_SPREADSHEET_ID o GOOGLE_SPREADSHEET_ID no está configurado en .env');
    }

    try {
      await this.sheets.spreadsheets.values.update({
        spreadsheetId: this.spreadsheetId,
        range: range,
        valueInputOption: 'RAW',
        resource: {
          values: values,
        },
      });

      console.log(`✅ Rango ${range} actualizado`);
    } catch (error) {
      console.error('❌ Error escribiendo en sheet:', error);
      throw error;
    }
  }

  /**
   * Agregar datos al final de un rango
   * @param {string} range - Rango en formato "SheetName!A:D"
   * @param {Array<Array>} values - Array de filas a agregar
   */
  async appendSheet(range, values) {
    if (!this.initialized) {
      await this.initialize();
    }

    if (!this.spreadsheetId) {
      throw new Error('GS_SPREADSHEET_ID o GOOGLE_SPREADSHEET_ID no está configurado en .env');
    }

    try {
      await this.sheets.spreadsheets.values.append({
        spreadsheetId: this.spreadsheetId,
        range: range,
        valueInputOption: 'RAW',
        insertDataOption: 'INSERT_ROWS',
        resource: {
          values: values,
        },
      });

      console.log(`✅ Datos agregados al rango ${range}`);
    } catch (error) {
      console.error('❌ Error agregando datos:', error);
      throw error;
    }
  }

  /**
   * Limpiar un rango
   * @param {string} range - Rango a limpiar
   */
  async clearRange(range) {
    if (!this.initialized) {
      await this.initialize();
    }

    if (!this.spreadsheetId) {
      throw new Error('GS_SPREADSHEET_ID o GOOGLE_SPREADSHEET_ID no está configurado en .env');
    }

    try {
      await this.sheets.spreadsheets.values.clear({
        spreadsheetId: this.spreadsheetId,
        range: range,
      });

      console.log(`✅ Rango ${range} limpiado`);
    } catch (error) {
      console.error('❌ Error limpiando rango:', error);
      throw error;
    }
  }

  /**
   * Obtener información de la spreadsheet
   */
  async getSpreadsheetInfo() {
    if (!this.initialized) {
      await this.initialize();
    }

    if (!this.spreadsheetId) {
      throw new Error('GS_SPREADSHEET_ID o GOOGLE_SPREADSHEET_ID no está configurado en .env');
    }

    try {
      const response = await this.sheets.spreadsheets.get({
        spreadsheetId: this.spreadsheetId,
      });

      return response.data;
    } catch (error) {
      console.error('❌ Error obteniendo info de spreadsheet:', error);
      throw error;
    }
  }
}

export default GoogleSheetsService;
