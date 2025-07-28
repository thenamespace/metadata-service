import { Injectable, Logger } from '@nestjs/common';
import {
  createCanvas,
  CanvasGradient,
  loadImage,
  CanvasRenderingContext2D,
} from 'canvas';
import * as path from 'path';

const IMAGE_SIZE = 1000;
const namespaceLogo = path.resolve(
  __dirname,
  '../assets/logo',
  'ninja-logo.png',
);

interface ImageCache {
  generated: number;
  stream: Buffer;
}

const MAX_NAME_LEN = 40;

@Injectable()
export class ImageService {
  private imageCache: Record<string, ImageCache> = {};

  public getImageForName = async (fullName: string, avatar?: string) => {
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
    this.attachText(ctx, fullName);

    return canvas.toBuffer();
  };

  private attachText = (ctx: CanvasRenderingContext2D, text: string) => {
    ctx.shadowColor = 'rgba(99, 99, 99, 0.5)';
    ctx.shadowOffsetX = 0;
    ctx.shadowOffsetY = 3;
    ctx.shadowBlur = 8;

    ctx.fillStyle = 'white';
    ctx.font = this.determineFontSize(text) + ' sans-serif';
    ctx.textAlign = 'start';
    ctx.fillText(this.shortenText(text), 100, 900);
  };

  private attachLogoToImage = async (ctx: CanvasRenderingContext2D) => {
    const ninjaLogoImg = await loadImage(namespaceLogo);
    ctx.drawImage(ninjaLogoImg, 100, 100, 150, 150);
  };

  private createAvatarBg = async (
    ctx: CanvasRenderingContext2D,
    bgImage: string,
  ) => {
    const img = await loadImage(this.cdnWrap(bgImage));
    ctx.drawImage(img, 10, 10, IMAGE_SIZE, IMAGE_SIZE);
  };

  private createGradiantBg = (ctx: CanvasRenderingContext2D) => {
    const gradient: CanvasGradient = ctx.createLinearGradient(
      0,
      0,
      IMAGE_SIZE,
      IMAGE_SIZE,
    );
    gradient.addColorStop(0, '#7990f7');
    gradient.addColorStop(1, '#44bcf0');

    ctx.shadowColor = 'rgba(99, 99, 99, 0.5)';
    ctx.shadowOffsetX = 0;
    ctx.shadowOffsetY = 3;
    ctx.shadowBlur = 8;

    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, IMAGE_SIZE, IMAGE_SIZE);
  };

  private determineFontSize = (name: string) => {
    const nameLen = name.length;
    if (nameLen <= 21) {
      return '70px';
    } else if (nameLen <= 25) {
      return '65px';
    } else if (nameLen <= 30) {
      return '55px';
    } else {
      return '40px';
    }
  };

  private shortenText = (name: string) => {
    if (name.length > MAX_NAME_LEN) {
      return name.substring(0, MAX_NAME_LEN - 3) + '...';
    }

    return name;
  };

  // there is an issue with digital ocean and imgur,
  // imgur doesn't allow image request from digitalocean servers for some reason
  private cdnWrap = (value: string) => {
    const isImgur = value.includes('imgur');
    if (isImgur) {
      return `https://wrpcd.net/cdn-cgi/image/anim=false,fit=contain,f=auto,w=288/${value}`;
    }
    return value;
  };
}
