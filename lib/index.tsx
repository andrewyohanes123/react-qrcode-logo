import saveAs from "file-saver";
import * as isEqual from "lodash.isequal";
import * as qrGenerator from "qrcode-generator";
import * as React from "react";
import * as ReactDOM from "react-dom";

type EyeColor = string | InnerOuterEyeColor;
type InnerOuterEyeColor = {
  inner: string;
  outer: string;
};

type CornerRadii = number | [number, number, number, number] | InnerOuterRadii;
type InnerOuterRadii = {
  inner: number | [number, number, number, number];
  outer: number | [number, number, number, number];
};

export interface IProps {
  value?: string;
  ecLevel?: "L" | "M" | "Q" | "H";
  enableCORS?: boolean;
  size?: number;
  quietZone?: number;
  bgColor?: string;
  fgColor?: string;
  logoImage?: string;
  logoWidth?: number;
  logoHeight?: number;
  logoOpacity?: number;
  logoOnLoad?: () => void;
  removeQrCodeBehindLogo?: boolean;
  logoPadding?: number;
  logoPaddingStyle?: "square" | "circle";
  eyeRadius?: CornerRadii | [CornerRadii, CornerRadii, CornerRadii];
  eyeColor?: EyeColor | [EyeColor, EyeColor, EyeColor];
  qrStyle?: "squares" | "dots";
  style?: object;
  id?: string;
}

interface ICoordinates {
  row: number;
  col: number;
}

export class QRCode extends React.Component<IProps, {}> {
  private canvas: React.RefObject<HTMLCanvasElement>;

  public static defaultProps: IProps = {
    value: "https://reactjs.org/",
    ecLevel: "M",
    enableCORS: false,
    size: 150,
    quietZone: 10,
    bgColor: "#FFFFFF",
    fgColor: "#000000",
    logoOpacity: 1,
    qrStyle: "squares",
    eyeRadius: [0, 0, 0],
    logoPaddingStyle: "square",
  };

  private static utf16to8(str: string): string {
    let out: string = "",
      i: number,
      c: number;
    const len: number = str.length;
    for (i = 0; i < len; i++) {
      c = str.charCodeAt(i);
      if (c >= 0x0001 && c <= 0x007f) {
        out += str.charAt(i);
      } else if (c > 0x07ff) {
        out += String.fromCharCode(0xe0 | ((c >> 12) & 0x0f));
        out += String.fromCharCode(0x80 | ((c >> 6) & 0x3f));
        out += String.fromCharCode(0x80 | ((c >> 0) & 0x3f));
      } else {
        out += String.fromCharCode(0xc0 | ((c >> 6) & 0x1f));
        out += String.fromCharCode(0x80 | ((c >> 0) & 0x3f));
      }
    }
    return out;
  }

  /**
   * Draw a rounded square in the canvas
   */
  private drawRoundedSquare(
    lineWidth: number,
    x: number,
    y: number,
    size: number,
    color: string,
    radii: number | number[],
    fill: boolean,
    ctx: CanvasRenderingContext2D
  ) {
    ctx.lineWidth = lineWidth;
    ctx.fillStyle = color;
    ctx.strokeStyle = color;

    // Adjust coordinates so that the outside of the stroke is aligned to the edges
    y += lineWidth / 2;
    x += lineWidth / 2;
    size -= lineWidth;

    if (!Array.isArray(radii)) {
      radii = [radii, radii, radii, radii];
    }

    // Radius should not be greater than half the size or less than zero
    radii = radii.map((r) => {
      r = Math.min(r, size / 2);
      return r < 0 ? 0 : r;
    });

    const rTopLeft = radii[0] || 0;
    const rTopRight = radii[1] || 0;
    const rBottomRight = radii[2] || 0;
    const rBottomLeft = radii[3] || 0;

    ctx.beginPath();

    ctx.moveTo(x + rTopLeft, y);

    ctx.lineTo(x + size - rTopRight, y);
    if (rTopRight) ctx.quadraticCurveTo(x + size, y, x + size, y + rTopRight);

    ctx.lineTo(x + size, y + size - rBottomRight);
    if (rBottomRight)
      ctx.quadraticCurveTo(
        x + size,
        y + size,
        x + size - rBottomRight,
        y + size
      );

    ctx.lineTo(x + rBottomLeft, y + size);
    if (rBottomLeft)
      ctx.quadraticCurveTo(x, y + size, x, y + size - rBottomLeft);

    ctx.lineTo(x, y + rTopLeft);
    if (rTopLeft) ctx.quadraticCurveTo(x, y, x + rTopLeft, y);

    ctx.closePath();

    ctx.stroke();
    if (fill) {
      ctx.fill();
    }
  }

  /**
   * Draw a single positional pattern eye.
   */
  private drawPositioningPattern(
    ctx: CanvasRenderingContext2D,
    cellSize: number,
    offset: number,
    row: number,
    col: number,
    color: EyeColor,
    radii: CornerRadii = [0, 0, 0, 0]
  ) {
    const lineWidth = Math.ceil(cellSize);

    let radiiOuter;
    let radiiInner;
    if (typeof radii !== "number" && !Array.isArray(radii)) {
      radiiOuter = radii.outer || 0;
      radiiInner = radii.inner || 0;
    } else {
      radiiOuter = radii as CornerRadii;
      radiiInner = radiiOuter;
    }

    let colorOuter;
    let colorInner;
    if (typeof color !== "string") {
      colorOuter = color.outer;
      colorInner = color.inner;
    } else {
      colorOuter = color;
      colorInner = color;
    }

    let y = row * cellSize + offset;
    let x = col * cellSize + offset;
    let size = cellSize * 7;

    // Outer box
    this.drawRoundedSquare(
      lineWidth,
      x,
      y,
      size,
      colorOuter,
      radiiOuter,
      false,
      ctx
    );

    // Inner box
    size = cellSize * 3;
    y += cellSize * 2;
    x += cellSize * 2;
    this.drawRoundedSquare(
      lineWidth,
      x,
      y,
      size,
      colorInner,
      radiiInner,
      true,
      ctx
    );
  }

  /**
   * Is this dot inside a positional pattern zone.
   */
  private isInPositioninZone(col: number, row: number, zones: ICoordinates[]) {
    return zones.some(
      (zone) =>
        row >= zone.row &&
        row <= zone.row + 7 &&
        col >= zone.col &&
        col <= zone.col + 7
    );
  }

  private transformPixelLengthIntoNumberOfCells(
    pixelLength: number,
    cellSize: number
  ) {
    return pixelLength / cellSize;
  }

  private isCoordinateInImage(
    col: number,
    row: number,
    dWidthLogo: number,
    dHeightLogo: number,
    dxLogo: number,
    dyLogo: number,
    cellSize: number,
    logoImage: string
  ) {
    if (logoImage) {
      const numberOfCellsMargin = 2;
      const firstRowOfLogo = this.transformPixelLengthIntoNumberOfCells(
        dxLogo,
        cellSize
      );
      const firstColumnOfLogo = this.transformPixelLengthIntoNumberOfCells(
        dyLogo,
        cellSize
      );
      const logoWidthInCells =
        this.transformPixelLengthIntoNumberOfCells(dWidthLogo, cellSize) - 1;
      const logoHeightInCells =
        this.transformPixelLengthIntoNumberOfCells(dHeightLogo, cellSize) - 1;

      return (
        row >= firstRowOfLogo - numberOfCellsMargin &&
        row <= firstRowOfLogo + logoWidthInCells + numberOfCellsMargin && // check rows
        col >= firstColumnOfLogo - numberOfCellsMargin &&
        col <= firstColumnOfLogo + logoHeightInCells + numberOfCellsMargin
      ); // check cols
    } else {
      return false;
    }
  }

  constructor(props: IProps) {
    super(props);
    this.canvas = React.createRef();
  }

  shouldComponentUpdate(nextProps: IProps) {
    return !isEqual(this.props, nextProps);
  }

  componentDidMount() {
    this.update();
  }

  componentDidUpdate() {
    this.update();
  }

  update() {
    const {
      value,
      ecLevel,
      enableCORS,
      bgColor,
      fgColor,
      logoImage,
      logoOpacity,
      logoOnLoad,
      removeQrCodeBehindLogo,
      qrStyle,
      eyeRadius,
      eyeColor,
      logoPaddingStyle,
    } = this.props;

    // just make sure that these params are passed as numbers
    const size = +this.props.size;
    const quietZone = +this.props.quietZone;
    const logoWidth = this.props.logoWidth ? +this.props.logoWidth : 0;
    const logoHeight = this.props.logoHeight ? +this.props.logoHeight : 0;
    const logoPadding = this.props.logoPadding ? +this.props.logoPadding : 0;

    const qrCode = qrGenerator(0, ecLevel);
    qrCode.addData(QRCode.utf16to8(value));
    qrCode.make();

    const canvas: HTMLCanvasElement = ReactDOM.findDOMNode(
      this.canvas.current
    ) as HTMLCanvasElement;
    const ctx: CanvasRenderingContext2D = canvas.getContext("2d");

    const canvasSize = size + 2 * quietZone;
    const length = qrCode.getModuleCount();
    const cellSize = size / length;
    const scale = window.devicePixelRatio || 1;
    canvas.height = canvas.width = canvasSize * scale;
    ctx.scale(scale, scale);

    ctx.fillStyle = bgColor;
    ctx.fillRect(0, 0, canvasSize, canvasSize);

    const offset = quietZone;

    const positioningZones: ICoordinates[] = [
      { row: 0, col: 0 },
      { row: 0, col: length - 7 },
      { row: length - 7, col: 0 },
    ];

    ctx.strokeStyle = fgColor;
    if (qrStyle === "dots") {
      ctx.fillStyle = fgColor;
      const radius = cellSize / 2;
      for (let row = 0; row < length; row++) {
        for (let col = 0; col < length; col++) {
          if (
            qrCode.isDark(row, col) &&
            !this.isInPositioninZone(row, col, positioningZones)
          ) {
            ctx.beginPath();
            ctx.arc(
              Math.round(col * cellSize) + radius + offset,
              Math.round(row * cellSize) + radius + offset,
              (radius / 100) * 75,
              0,
              2 * Math.PI,
              false
            );
            ctx.closePath();
            ctx.fill();
          }
        }
      }
    } else {
      for (let row = 0; row < length; row++) {
        for (let col = 0; col < length; col++) {
          if (
            qrCode.isDark(row, col) &&
            !this.isInPositioninZone(row, col, positioningZones)
          ) {
            ctx.fillStyle = fgColor;
            const w =
              Math.ceil((col + 1) * cellSize) - Math.floor(col * cellSize);
            const h =
              Math.ceil((row + 1) * cellSize) - Math.floor(row * cellSize);
            ctx.fillRect(
              Math.round(col * cellSize) + offset,
              Math.round(row * cellSize) + offset,
              w,
              h
            );
          }
        }
      }
    }

    // Draw positioning patterns
    for (let i = 0; i < 3; i++) {
      const { row, col } = positioningZones[i];

      let radii = eyeRadius;
      let color;

      if (Array.isArray(radii)) {
        radii = radii[i];
      }
      if (typeof radii == "number") {
        radii = [radii, radii, radii, radii];
      }

      if (!eyeColor) {
        // if not specified, eye color is the same as foreground,
        color = fgColor;
      } else {
        if (Array.isArray(eyeColor)) {
          // if array, we pass the single color
          color = eyeColor[i];
        } else {
          color = eyeColor as EyeColor;
        }
      }

      this.drawPositioningPattern(
        ctx,
        cellSize,
        offset,
        row,
        col,
        color,
        radii as CornerRadii
      );
    }

    if (logoImage) {
      const image = new Image();
      if (enableCORS) {
        image.crossOrigin = "Anonymous";
      }
      image.onload = () => {
        ctx.save();

        const dWidthLogo = logoWidth || size * 0.2;
        const dHeightLogo = logoHeight || dWidthLogo;
        const dxLogo = (size - dWidthLogo) / 2;
        const dyLogo = (size - dHeightLogo) / 2;

        if (removeQrCodeBehindLogo || logoPadding) {
          ctx.beginPath();

          ctx.strokeStyle = bgColor;
          ctx.fillStyle = bgColor;

          const dWidthLogoPadding = dWidthLogo + 2 * logoPadding;
          const dHeightLogoPadding = dHeightLogo + 2 * logoPadding;
          const dxLogoPadding = dxLogo + offset - logoPadding;
          const dyLogoPadding = dyLogo + offset - logoPadding;

          if (logoPaddingStyle === "circle") {
            const dxCenterLogoPadding = dxLogoPadding + dWidthLogoPadding / 2;
            const dyCenterLogoPadding = dyLogoPadding + dHeightLogoPadding / 2;
            ctx.ellipse(
              dxCenterLogoPadding,
              dyCenterLogoPadding,
              dWidthLogoPadding / 2,
              dHeightLogoPadding / 2,
              0,
              0,
              2 * Math.PI
            );
            ctx.stroke();
            ctx.fill();
          } else {
            ctx.fillRect(
              dxLogoPadding,
              dyLogoPadding,
              dWidthLogoPadding,
              dHeightLogoPadding
            );
          }
        }

        ctx.globalAlpha = logoOpacity;
        ctx.drawImage(
          image,
          dxLogo + offset,
          dyLogo + offset,
          dWidthLogo,
          dHeightLogo
        );
        ctx.restore();
        if (logoOnLoad) {
          logoOnLoad();
        }
      };
      image.src = logoImage;
    }
  }

  saveAsImage = (filename?: string) => {
    const base64: string = this.canvas.current.toDataURL("image/png", 1);
    saveAs(base64, filename ?? "QRCode.png");
  };

  render() {
    const qrSize = +this.props.size + 2 * +this.props.quietZone;
    return React.createElement("canvas", {
      id: this.props.id ?? "react-qrcode-logo",
      height: qrSize,
      width: qrSize,
      style: { height: qrSize + "px", width: qrSize + "px" },
      ref: this.canvas,
    });
  }
}
