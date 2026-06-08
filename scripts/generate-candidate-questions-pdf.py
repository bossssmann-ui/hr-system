#!/usr/bin/env python3
"""
Generate a PDF document containing every candidate-facing question and
practical assignment used in the Selection subsystem.

Usage:
    bun run scripts/dump-candidate-questions.ts > /tmp/q.json
    python3 scripts/generate-candidate-questions-pdf.py /tmp/q.json docs/candidate-questions.pdf
"""

import json
import sys
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.units import cm
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import (
    SimpleDocTemplate,
    Paragraph,
    Spacer,
    PageBreak,
    ListFlowable,
    ListItem,
    KeepTogether,
)


FONT_REG = "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"
FONT_BOLD = "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"
FONT_ITALIC = "/usr/share/fonts/truetype/dejavu/DejaVuSans-Oblique.ttf"

pdfmetrics.registerFont(TTFont("Sans", FONT_REG))
pdfmetrics.registerFont(TTFont("Sans-Bold", FONT_BOLD))
pdfmetrics.registerFont(TTFont("Sans-Italic", FONT_ITALIC))


STAGE_TYPE_LABEL = {
    "questionnaire": "Анкета-скрининг",
    "test": "Профессиональный тест",
    "psychology": "Психологический тест",
    "assignment": "Практическое тестовое задание",
}

QUESTION_TYPE_LABEL = {
    "number": "Число",
    "radio": "Один вариант ответа",
    "checkbox": "Несколько вариантов ответа",
    "textarea": "Открытый ответ",
    "scale": "Шкала 1–5",
}


def make_styles():
    base = getSampleStyleSheet()
    styles = {
        "title": ParagraphStyle(
            "title", parent=base["Title"], fontName="Sans-Bold",
            fontSize=22, leading=26, spaceAfter=12,
        ),
        "h1": ParagraphStyle(
            "h1", parent=base["Heading1"], fontName="Sans-Bold",
            fontSize=18, leading=22, spaceBefore=8, spaceAfter=10,
            textColor="#1f2d5a",
        ),
        "h2": ParagraphStyle(
            "h2", parent=base["Heading2"], fontName="Sans-Bold",
            fontSize=14, leading=18, spaceBefore=10, spaceAfter=6,
            textColor="#2b3a67",
        ),
        "h3": ParagraphStyle(
            "h3", parent=base["Heading3"], fontName="Sans-Bold",
            fontSize=11, leading=14, spaceBefore=4, spaceAfter=2,
        ),
        "body": ParagraphStyle(
            "body", parent=base["BodyText"], fontName="Sans",
            fontSize=10.5, leading=14, spaceAfter=4,
        ),
        "meta": ParagraphStyle(
            "meta", parent=base["BodyText"], fontName="Sans-Italic",
            fontSize=9.5, leading=12, textColor="#666666", spaceAfter=6,
        ),
        "qnum": ParagraphStyle(
            "qnum", parent=base["BodyText"], fontName="Sans-Bold",
            fontSize=10.5, leading=14, spaceBefore=8, spaceAfter=2,
        ),
        "answer_ok": ParagraphStyle(
            "answer_ok", parent=base["BodyText"], fontName="Sans-Italic",
            fontSize=9.5, leading=12, textColor="#1d6f1d",
            leftIndent=12, spaceAfter=4,
        ),
        "block": ParagraphStyle(
            "block", parent=base["BodyText"], fontName="Sans",
            fontSize=10.5, leading=14, leftIndent=12, spaceAfter=4,
        ),
    }
    return styles


def esc(text: str) -> str:
    return (
        str(text)
        .replace("&", "&amp;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
    )


def render_stage(stage, styles, story):
    stype = stage["type"]
    title = stage["title"]
    label = STAGE_TYPE_LABEL.get(stype, stype)
    story.append(Paragraph(
        f"Этап {stage['stage']}. {esc(label)} — {esc(title)}", styles["h2"]
    ))
    meta = []
    tl = stage.get("timeLimitMin")
    if tl:
        meta.append(f"Лимит времени: {tl} мин")
    if stype == "test":
        meta.append(f"Макс. балл: {stage['maxScore']}")
        meta.append(f"Порог прохождения: {stage['passThreshold']}")
    if stype == "psychology":
        scale = stage["scale"]
        meta.append(
            "Шкала: " + ", ".join(f"{i+1}={esc(l)}" for i, l in enumerate(scale["labels"]))
        )
    if stype == "assignment":
        if stage.get("timeEstimate"):
            meta.append(f"Оценка времени: {stage['timeEstimate']}")
    if meta:
        story.append(Paragraph(" • ".join(meta), styles["meta"]))

    if stype == "assignment":
        story.append(Paragraph("<b>Описание задания:</b>", styles["body"]))
        for para in stage["description"].split("\n"):
            if para.strip():
                story.append(Paragraph(esc(para), styles["block"]))
        traps = stage.get("traps") or []
        if traps:
            story.append(Paragraph("<b>Контрольные критерии (ловушки):</b>", styles["body"]))
            for t in traps:
                story.append(Paragraph(
                    f"{t['id']}. {esc(t['description'])}", styles["block"]
                ))
        return

    questions = stage.get("questions") or []
    last_block = None
    for i, q in enumerate(questions, start=1):
        block = q.get("block")
        if block and block != last_block:
            story.append(Paragraph(f"Блок {esc(block)}", styles["h3"]))
            last_block = block
        flow = []
        qtype = QUESTION_TYPE_LABEL.get(q["type"], q["type"])
        weight_str = ""
        if q.get("weight"):
            weight_str = f" · вес {q['weight']}"
        flow.append(Paragraph(
            f"{i}. {esc(q['text'])} <font color='#888888'>"
            f"[{esc(qtype)}{weight_str}]</font>",
            styles["qnum"],
        ))
        opts = q.get("options")
        if opts:
            items = [ListItem(Paragraph(esc(o), styles["body"]),
                              leftIndent=18, value="circle")
                     for o in opts]
            flow.append(ListFlowable(items, bulletType="bullet",
                                     leftIndent=18, bulletFontName="Sans"))
        if q.get("correct"):
            flow.append(Paragraph(
                f"✓ Правильный ответ: {esc(q['correct'])}",
                styles["answer_ok"],
            ))
        story.append(KeepTogether(flow))


def render_role(role, styles, story, is_first):
    if not is_first:
        story.append(PageBreak())
    story.append(Paragraph(esc(role["title"]), styles["h1"]))
    story.append(Paragraph(f"Идентификатор роли/пакета: <font face='Sans'>{esc(role['id'])}</font>",
                           styles["meta"]))
    if not role["stages"]:
        story.append(Paragraph("Нет содержимого этапов.", styles["body"]))
        return
    for stage in role["stages"]:
        render_stage(stage, styles, story)


def main():
    if len(sys.argv) < 3:
        print("Usage: generate-candidate-questions-pdf.py <input.json> <output.pdf>",
              file=sys.stderr)
        sys.exit(2)
    src, dst = sys.argv[1], sys.argv[2]
    with open(src, encoding="utf-8") as f:
        roles = json.load(f)

    styles = make_styles()
    doc = SimpleDocTemplate(
        dst, pagesize=A4,
        leftMargin=1.8 * cm, rightMargin=1.8 * cm,
        topMargin=1.6 * cm, bottomMargin=1.6 * cm,
        title="Вопросы и тестовые задания для соискателей",
        author="HR-system (Onboardix)",
    )
    story = []
    story.append(Paragraph("Вопросы и тестовые задания для соискателей",
                           styles["title"]))
    story.append(Paragraph(
        "Полный свод вопросов анкет, профессиональных и психологических тестов, "
        "а также практических заданий, используемых на этапах онлайн-отбора. "
        "Документ собран автоматически из исходного кода системы отбора "
        "(<i>backend/src/features/selection/stage-content.ts</i> и "
        "<i>domestic-stage-content.ts</i>).",
        styles["body"],
    ))
    story.append(Paragraph(
        f"Всего ролей/пакетов: {len(roles)}.",
        styles["meta"],
    ))

    # Table of contents
    story.append(Paragraph("Содержание", styles["h2"]))
    for i, role in enumerate(roles, start=1):
        story.append(Paragraph(f"{i}. {esc(role['title'])}", styles["body"]))

    for i, role in enumerate(roles):
        render_role(role, styles, story, is_first=False)

    def footer(canvas, doc_):
        canvas.saveState()
        canvas.setFont("Sans", 8)
        canvas.setFillColorRGB(0.45, 0.45, 0.45)
        canvas.drawRightString(
            A4[0] - 1.8 * cm, 1.0 * cm,
            f"Стр. {doc_.page}",
        )
        canvas.drawString(
            1.8 * cm, 1.0 * cm,
            "Вопросы и тестовые задания для соискателей",
        )
        canvas.restoreState()

    doc.build(story, onFirstPage=footer, onLaterPages=footer)
    print(f"Wrote {dst}")


if __name__ == "__main__":
    main()
