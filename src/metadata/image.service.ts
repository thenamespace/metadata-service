/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-var-requires, @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access */
import { Injectable, Logger } from '@nestjs/common';
import * as path from 'path';
type CanvasRenderingContext2D = any;
type CanvasGradient = any;

const IMAGE_SIZE = 1000;
const MAX_LABEL_LEN = 18;
const namespaceLogo = path.resolve(
  __dirname,
  '../assets/logo',
  'ninja-logo.png',
);
const pizzadaoLogo = path.resolve(
  __dirname,
  "../assets/logo",
  "pizzadao_logo.jpeg"
)

// These are custom metadata logos for some clients
// pizzadao, we should make this dynamic in the future
const customLogos: Record<string, string> = {
  "pizzadao.eth": pizzadaoLogo,
  "pizzamafia.eth": pizzadaoLogo,
  "rarepizzas": pizzadaoLogo,
}

let canvasLib: any | null = null;
let canvasInitialized = false;

function ensureCanvasLoaded(): any | null {
  if (canvasInitialized && canvasLib) return canvasLib;
  try {
    const mod = require('canvas');
    const fontPath = path.resolve(__dirname, '../assets/fonts', 'Satoshi-Bold.otf');
    mod.registerFont(fontPath, { family: 'Satoshi' });
    canvasLib = mod;
    canvasInitialized = true;
    return mod;
  } catch {
    return null;
  }
}

interface ImageCache {
  generated: number;
  stream: Buffer;
}

const MAX_NAME_LEN = 40;

@Injectable()
export class ImageService {
  private imageCache: Record<string, ImageCache> = {};

  public getCachedImage(node: string) {
    return this.imageCache[node];
  }

  public generateImageForName = async (fullName: string, avatar?: string) => {
    if (this.imageCache[fullName]) {
      return this.imageCache[fullName].stream;
    }

    const buffer = await this.generateImage(fullName, avatar);
    this.imageCache[fullName] = {
      generated: new Date().getTime(),
      stream: buffer,
    };

    return buffer;
  };

  private generateImage = async (fullName: string, bgImage?: string) => {
    const mod = ensureCanvasLoaded();
    if (!mod) {
      return this.generateSvgFallback(fullName);
    }
    const { createCanvas } = mod;
    const canvas = createCanvas(IMAGE_SIZE, IMAGE_SIZE);
    const ctx = canvas.getContext('2d');
    this.createGradiantBg(ctx);
    if (bgImage) {
      try {
        await this.createAvatarBg(ctx, bgImage);
      } catch (err) {
        Logger.error(`Error generating image with bg ${bgImage}`, err);
      }
    }

    await this.attachLogoToImage(ctx);
    await this.attachCustomLogo(fullName, ctx);
    this.attachText(ctx, fullName);

    return canvas.toBuffer();
  };

  private attachText = (ctx: CanvasRenderingContext2D, text: string) => {
    ctx.shadowColor = 'rgba(99, 99, 99, 0.7)';
    ctx.shadowOffsetX = 0;
    ctx.shadowOffsetY = 3;
    ctx.shadowBlur = 8;
    const split = text.split(".");

    ctx.fillStyle = 'white';
    ctx.textAlign = 'start';

    if (split.length <= 2) {
      ctx.font = this.getFontSize() + ' Satoshi';
      ctx.fillText(text, 100, 900);
    } else {
      const subnameLabel = split.slice(0, -2).join('.');
      const parentName = `${split[split.length - 2]}.${split[split.length - 1]}`;

      ctx.font = this.getFontSize() + ' Satoshi';
      ctx.fillText(`${this.shortenText(subnameLabel, MAX_LABEL_LEN)}.`, 100, 820);

      ctx.globalAlpha = 0.7;
      ctx.font = this.getFontSize() + ' Satoshi';
      ctx.fillText(`${this.shortenText(parentName, MAX_LABEL_LEN)}`, 100, 900);
      ctx.globalAlpha = 1;
    }
  };

  private attachLogoToImage = async (ctx: CanvasRenderingContext2D) => {
    const mod = ensureCanvasLoaded();
    if (!mod) return;
    const { loadImage } = mod;
    const ninjaLogoImg = await loadImage(namespaceLogo);
    ctx.drawImage(ninjaLogoImg, 100, 100, 150, 150);
  };

  private attachCustomLogo = async (fullName: string, ctx: CanvasRenderingContext2D) => {

    let parentName = fullName;
    const split = parentName.split(".");
    if (split.length > 2) {
      parentName = `${split[split.length -2]}.${split[split.length - 1]}`;
    }

    if (customLogos[parentName]) {

        try {
          const mod = ensureCanvasLoaded();
          if (!mod) return;
          const { loadImage } = mod;
          const customLogoUrl = customLogos[parentName];
          const customLogo = await loadImage(customLogoUrl);
          ctx.drawImage(customLogo, 700, 100, 150, 150);
        } catch(err) {
          Logger.error("Failed to attach custom logo", err);
        }
    }
  }

  private createAvatarBg = async (
    ctx: CanvasRenderingContext2D,
    bgImage: string,
  ) => {

    try {
      const mod = ensureCanvasLoaded();
      if (!mod) return;
      const { loadImage } = mod;
      const img = await loadImage(bgImage);
      ctx.drawImage(img, 0, 0, IMAGE_SIZE, IMAGE_SIZE);
    } catch (err) {
      Logger.error("Failed to apply avatar to bg", err);
    }
  };

  private generateSvgFallback(fullName: string): Buffer {
    const safe = fullName.replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${IMAGE_SIZE}" height="${IMAGE_SIZE}">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#7990f7" />
      <stop offset="100%" stop-color="#44bcf0" />
    </linearGradient>
  </defs>
  <rect width="100%" height="100%" fill="url(#g)" />
  <text x="100" y="900" font-size="105" font-family="Arial, Helvetica, sans-serif" fill="#ffffff">${safe}</text>
  <title>Generated without native canvas bindings</title>
</svg>`;
    return Buffer.from(svg, 'utf8');
  }

  private createGradiantBg = (ctx: CanvasRenderingContext2D) => {
    const gradient: CanvasGradient = this.defaultGradiant(ctx);

    ctx.shadowColor = 'rgba(99, 99, 99, 1)';
    ctx.shadowOffsetX = 0;
    ctx.shadowOffsetY = 3;
    ctx.shadowBlur = 8;

    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, IMAGE_SIZE, IMAGE_SIZE);
  };

  private defaultGradiant = (ctx: CanvasRenderingContext2D) => {
    const gradient: CanvasGradient = ctx.createLinearGradient(
      0,
      0,
      IMAGE_SIZE,
      IMAGE_SIZE,
    );
    gradient.addColorStop(0, '#7990f7');
    gradient.addColorStop(1, '#44bcf0');

    return gradient;
  }

  private getFontSize = () => {
    return "105px";
  };

  private shortenText = (name: string, max_len: number) => {
    if (name.length > max_len) {
      return name.substring(0, 6) + '...' + name.substring(name.length - 6); 
    }

    return name;
  };
}
