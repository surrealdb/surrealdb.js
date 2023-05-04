export default function (string: string) {
	return Buffer.from(string).toString("base64");
}
