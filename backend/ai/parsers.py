"""
Document parsers for the meeting ingestion feature (future).

Will extract raw text from uploaded PDF / DOCX files,
which is then passed to chains.extract_tasks_from_transcript().

Usage (when building the feature):
    from ai.parsers import extract_text_from_pdf, extract_text_from_docx
"""


def extract_text_from_pdf(file_bytes: bytes) -> str:
    """
    Extract plain text from a PDF file.

    Activate by installing: pip install pypdf
    Then replace the body with:
        import pypdf, io
        reader = pypdf.PdfReader(io.BytesIO(file_bytes))
        return "\n".join(page.extract_text() or "" for page in reader.pages)
    """
    raise NotImplementedError("PDF parsing is reserved for the meeting ingestion feature.")


def extract_text_from_docx(file_bytes: bytes) -> str:
    """
    Extract plain text from a DOCX file.

    Activate by installing: pip install python-docx
    Then replace the body with:
        import docx, io
        doc = docx.Document(io.BytesIO(file_bytes))
        return "\n".join(p.text for p in doc.paragraphs if p.text.strip())
    """
    raise NotImplementedError("DOCX parsing is reserved for the meeting ingestion feature.")
