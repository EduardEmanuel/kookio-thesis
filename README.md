# kookio-thesis

Kookio: A Modular Full-Stack Gastronomic Service Built on the PAN Architecture (Prisma – Analog – Nx)

> 📁 This repository contains only the academic thesis associated with the [Kookio application](https://github.com/EduardEmanuel/kookio), including:

> - LaTeX sources
> - Compilation scripts
> - University assets (logos, styles)

## 📦 Prerequisites

| Tool | Purpose | How to Install |
|------|---------|----------------|
| **XeLaTeX** (via TeX Live, MacTeX, or MikTeX) | Compile thesis in LaTeX | See below |

### 📌 XeLaTeX Note

To compile the thesis using LaTeX + Unicode fonts:

- **macOS:** `brew install --cask mactex`
- **Ubuntu/Debian:** `sudo apt install texlive-xetex texlive-fonts-recommended texlive-latex-extra`
- **Windows:** install [MikTeX](https://miktex.org/download) and enable `xetex` + `biblatex` in the package manager.

## 🎓 Academic Program

Bachelor’s Thesis – Computer Science
Faculty of Mathematics and Computer Science
University of Bucharest

## ✍️ Author

Eduard - Emanuel Dinea

## 🧑‍🏫 Supervisor

Lect. Dr. Mihai Cherciu

## 📄 Thesis Abstract

This thesis presents the design and implementation of Kookio, an interactive gastronomic web platform developed using a modern, modular, and type-safe full-stack architecture referred to as PAN—composed of Prisma for data access, Analog for Angular SSR capabilities, and Nx for scalable project orchestration in a monorepo context.

The application enables users to manage personal ingredient inventories, receive intelligent recipe suggestions, and locate missing items in nearby stores. Kookio leverages cutting-edge tools such as tRPC for end-to-end type safety, Zod for validation, and PostgreSQL as the underlying relational database. Testing and automation are orchestrated via Vitest, Playwright, and Nx workflows.

The thesis explores key architectural decisions, component integrations, and developer experience enhancements. It also outlines a future-proof roadmap that includes CockroachDB for distributed persistence, Redis for caching, and AI-driven recommendation engines.

All academic materials, including the thesis manuscript, bibliography, LaTeX source files, and compiled PDFs, are maintained in repository (kookio-thesis) to ensure version control and integrity prior to public defense.
