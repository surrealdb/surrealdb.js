export enum TokenKind {
    // Objects & arrays
    BraceOpen = "BraceOpen",
    BraceClose = "BraceClose",
    SquareOpen = "SquareOpen",
    SquareClose = "SquareClose",
    Colon = "Colon",
    Comma = "Comma",
    
    // Strings
    QuoteDouble = "QuoteDouble",
    QuoteSingle = "QuoteSingle",
    StringDouble = "StringDouble",
    StringSingle = "StringSingle",
    BytesDouble = "BytesDouble",
    BytesSingle = "BytesSingle",
    DatetimeDouble = "DatetimeDouble",
    DatetimeSingle = "DatetimeSingle",
    UuidDouble = "UuidDouble",
    UuidSingle = "UuidSingle",
    RecordDouble = "RecordDouble",
    RecordSingle = "RecordSingle",
    FileDouble = "FileDouble",
    FileSingle = "FileSingle",

    // Escape
    Backtick = "Backtick",
    MathematicalOpen = "MathematicalOpen",
    MathematicalClose = "MathematicalClose",

    // Ident
    Ident = "Ident",

    // Number,
    Number = "Number",
    Dot = "Dot",
}