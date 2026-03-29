// src/app/pages/home.ts
import { Component, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { RouterLink } from '@angular/router';

interface Chapter {
  path: string;
  file: string;
  title: string;
}

interface Part {
  name: string;
  title: string;
  chapters: Chapter[];
}

interface Manifest {
  parts: Part[];
}

@Component({
  selector: 'app-home',
  imports: [RouterLink],
  template: `
    <div class="home-container">
      <div class="home-hero">
        <h1>State Management in Angular</h1>
        <p>The Definitive Guide &mdash; 39 chapters across 7 parts</p>
      </div>

      @if (manifest()) {
        @for (part of manifest()!.parts; track part.name) {
          <section class="part-section">
            <h2 class="part-title">{{ part.title }}</h2>
            <div class="chapter-grid">
              @for (chapter of part.chapters; track chapter.path) {
                <a [routerLink]="'/' + chapter.path" class="chapter-card">
                  <span class="chapter-title">{{ chapter.title }}</span>
                </a>
              }
            </div>
          </section>
        }
      } @else if (error()) {
        <p class="home-error">Failed to load chapter list.</p>
      } @else {
        <p class="home-loading">Loading&hellip;</p>
      }
    </div>
  `,
  styles: `
    .home-container {
      max-width: 900px;
      margin: 0 auto;
      padding: 3rem 2rem;
    }

    .home-hero {
      margin-bottom: 3rem;
    }

    .home-hero h1 {
      font-size: 2rem;
      font-weight: 800;
      color: #0f172a;
      margin-bottom: 0.5rem;
      letter-spacing: -0.03em;
    }

    .home-hero p {
      color: #64748b;
      font-size: 1rem;
    }

    .part-section {
      margin-bottom: 2.5rem;
    }

    .part-title {
      font-size: 0.75rem;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.08em;
      color: #94a3b8;
      margin-bottom: 1rem;
      padding-bottom: 0.5rem;
      border-bottom: 1px solid #e2e8f0;
    }

    .chapter-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(min(260px, 100%), 1fr));
      gap: 0.75rem;
    }

    .chapter-card {
      display: block;
      padding: 1rem 1.25rem;
      background: #fff;
      border: 1px solid #e2e8f0;
      border-radius: 8px;
      text-decoration: none;
      transition: border-color 0.15s, box-shadow 0.15s;
    }

    .chapter-card:hover {
      border-color: #7dd3fc;
      box-shadow: 0 2px 8px rgba(0, 0, 0, 0.06);
    }

    .chapter-title {
      font-size: 0.9rem;
      font-weight: 500;
      color: #1e293b;
      line-height: 1.4;
    }

    .home-loading,
    .home-error {
      color: #64748b;
      padding: 2rem 0;
    }

    @media (max-width: 480px) {
      .home-container {
        padding: 2rem 1rem;
      }

      .home-hero {
        margin-bottom: 2rem;
      }

      .home-hero h1 {
        font-size: 1.5rem;
      }
    }
  `,
})
export class HomePage {
  private http = inject(HttpClient);

  manifest = signal<Manifest | null>(null);
  error = signal(false);

  constructor() {
    this.http.get<Manifest>('/manifest.json').subscribe({
      next: (data) => this.manifest.set(data),
      error: () => this.error.set(true),
    });
  }
}
