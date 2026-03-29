// src/app/pages/chapter-viewer.ts
import { Component, inject, signal, OnDestroy } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Router, RouterLink, NavigationEnd } from '@angular/router';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { Subscription, filter } from 'rxjs';
import { marked, Renderer } from 'marked';
import Prism from 'prismjs';
import 'prismjs/components/prism-typescript';
import 'prismjs/components/prism-bash';
import 'prismjs/components/prism-json';
import 'prismjs/components/prism-css';
import 'prismjs/components/prism-markup';

// Configure marked with PrismJS syntax highlighting
const renderer = new Renderer();
renderer.code = ({ text, lang }) => {
  const language = lang && Prism.languages[lang] ? lang : 'typescript';
  const highlighted = Prism.highlight(text, Prism.languages[language], language);
  return `<pre class="language-${language}"><code class="language-${language}">${highlighted}</code></pre>`;
};
marked.use({ renderer });

@Component({
  selector: 'app-chapter-viewer',
  imports: [RouterLink],
  template: `
    @if (loading()) {
      <div class="viewer-state">Loading chapter&hellip;</div>
    } @else if (error()) {
      <div class="viewer-state viewer-error">
        <h2>Chapter not found</h2>
        <p>No markdown file exists at this path.</p>
        <a routerLink="/" class="back-link">&larr; Back to home</a>
      </div>
    } @else {
      <article class="chapter-content" [innerHTML]="htmlContent()"></article>
    }
  `,
  styles: `
    .viewer-state {
      max-width: 700px;
      margin: 4rem auto;
      padding: 0 2rem;
      color: #64748b;
    }

    .viewer-error h2 {
      font-size: 1.5rem;
      color: #0f172a;
      margin-bottom: 0.5rem;
    }

    .viewer-error p {
      margin-bottom: 1.5rem;
    }

    .back-link {
      color: #0ea5e9;
      text-decoration: none;
      font-weight: 500;
    }

    .back-link:hover {
      text-decoration: underline;
    }

    .chapter-content {
      max-width: 720px;
      margin: 0 auto;
      padding: 3rem 2rem 5rem;
    }

    @media (max-width: 480px) {
      .viewer-state {
        padding: 0 1rem;
        margin: 2rem auto;
      }

      .chapter-content {
        padding: 1.5rem 1rem 3rem;
      }
    }
  `,
})
export class ChapterViewerPage implements OnDestroy {
  private http = inject(HttpClient);
  private router = inject(Router);
  private sanitizer = inject(DomSanitizer);
  private sub: Subscription;

  htmlContent = signal<SafeHtml>('');
  loading = signal(true);
  error = signal(false);

  constructor() {
    // Load on init and on every subsequent navigation
    this.loadChapter(this.router.url);
    this.sub = this.router.events
      .pipe(filter((e) => e instanceof NavigationEnd))
      .subscribe((e) => this.loadChapter((e as NavigationEnd).urlAfterRedirects));
  }

  private loadChapter(urlPath: string) {
    // Strip query params / fragments
    const cleanPath = urlPath.split('?')[0].split('#')[0];
    this.loading.set(true);
    this.error.set(false);

    this.http.get(`${cleanPath}.md`, { responseType: 'text' }).subscribe({
      next: (markdown) => {
        const html = marked.parse(markdown) as string;
        this.htmlContent.set(this.sanitizer.bypassSecurityTrustHtml(html));
        this.loading.set(false);
      },
      error: () => {
        this.error.set(true);
        this.loading.set(false);
      },
    });
  }

  ngOnDestroy() {
    this.sub.unsubscribe();
  }
}
