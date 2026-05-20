import { Injectable, Logger } from '@nestjs/common';
import {
  createCanvas,
  CanvasGradient,
  loadImage,
  CanvasRenderingContext2D,
  registerFont,
} from 'canvas';
import * as path from 'path';

const IMAGE_SIZE = 1000;
const MAX_LABEL_LEN = 18;
const namespaceLogo = path.resolve(
  __dirname,
  '../assets/logo',
  'ninja-logo.png',
);
const pizzadaoLogo = path.resolve(
  __dirname,
  '../assets/logo',
  'pizzadao_logo.jpeg',
);

// These are custom metadata logos for some clients
// pizzadao, we should make this dynamic in the future
const customLogos: Record<string, string> = {
  'pizzadao.eth': pizzadaoLogo,
  'pizzamafia.eth': pizzadaoLogo,
  rarepizzas: pizzadaoLogo,
};

const FONT_PATH = path.resolve(
  __dirname,
  '../assets/fonts',
  'Satoshi-Bold.otf',
);
registerFont(FONT_PATH, { family: 'Satoshi' });

interface ImageCache {
  generated: number;
  stream: Buffer;
}

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
    const split = text.split('.');

    ctx.fillStyle = 'white';
    ctx.textAlign = 'start';

    if (split.length <= 2) {
      ctx.font = this.getFontSize() + ' Satoshi';
      ctx.fillText(text, 100, 900);
    } else {
      const subnameLabel = split.slice(0, -2).join('.');
      const parentName = `${split[split.length - 2]}.${split[split.length - 1]}`;

      ctx.font = this.getFontSize() + ' Satoshi';
      ctx.fillText(
        `${this.shortenText(subnameLabel, MAX_LABEL_LEN)}.`,
        100,
        820,
      );

      ctx.globalAlpha = 0.7;
      ctx.font = this.getFontSize() + ' Satoshi';
      ctx.fillText(`${this.shortenText(parentName, MAX_LABEL_LEN)}`, 100, 900);
      ctx.globalAlpha = 1;
    }
  };

  private attachLogoToImage = async (ctx: CanvasRenderingContext2D) => {
    const ninjaLogoImg = await loadImage(namespaceLogo);
    ctx.drawImage(ninjaLogoImg, 100, 100, 150, 150);
  };

  private attachCustomLogo = async (
    fullName: string,
    ctx: CanvasRenderingContext2D,
  ) => {
    let parentName = fullName;
    const split = parentName.split('.');
    if (split.length > 2) {
      parentName = `${split[split.length - 2]}.${split[split.length - 1]}`;
    }

    if (customLogos[parentName]) {
      try {
        const customLogoUrl = customLogos[parentName];
        const customLogo = await loadImage(customLogoUrl);
        ctx.drawImage(customLogo, 700, 100, 150, 150);
      } catch (err) {
        Logger.error('Failed to attach custom logo', err);
      }
    }
  };

  private createAvatarBg = async (
    ctx: CanvasRenderingContext2D,
    bgImage: string,
  ) => {
    try {
      const img = await loadImage(bgImage);
      ctx.drawImage(img, 0, 0, IMAGE_SIZE, IMAGE_SIZE);
    } catch (err) {
      Logger.error('Failed to apply avatar to bg', err);
    }
  };

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
  };

  private getFontSize = () => {
    return '105px';
  };

  private shortenText = (name: string, max_len: number) => {
    if (name.length > max_len) {
      return name.substring(0, 6) + '...' + name.substring(name.length - 6);
    }

    return name;
  };
}
