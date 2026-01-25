# Directorio de Resúmenes Bancarios

Este directorio contiene los PDFs de resúmenes bancarios que se procesan mediante el endpoint `/resumes/syncResumes`.

## Nomenclatura de archivos

Los archivos PDF deben seguir esta nomenclatura:

- `VISA_MM_YYYY.pdf` - Resúmenes de VISA
- `MASTERCARD_MM_YYYY.pdf` - Resúmenes de MASTERCARD

Donde:
- `MM` = Mes (01-12)
- `YYYY` = Año (ej: 2026)

### Ejemplos:
- `VISA_01_2026.pdf` - Resumen de VISA de enero 2026
- `MASTERCARD_01_2026.pdf` - Resumen de MASTERCARD de enero 2026
- `VISA_02_2026.pdf` - Resumen de VISA de febrero 2026

## Uso

1. Coloca los PDFs en este directorio con la nomenclatura correcta
2. Llama al endpoint `POST /resumes/syncResumes`
3. El endpoint procesará todos los PDFs y devolverá la información estructurada
4. Cada PDF generará un UUID único basado en el hash del contenido (si procesas el mismo PDF dos veces, obtendrás el mismo UUID)
