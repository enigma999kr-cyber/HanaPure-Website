import "server-only";

import { editorialProducts } from "../../data/catalogue";
import { createLocalCatalogueReader } from "./editorial-catalogue";

export const localCatalogue = createLocalCatalogueReader(editorialProducts);
